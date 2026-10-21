import { todayInTimeZone } from '$lib/availability/calculate';
import { logServerFailure } from '$lib/server/platform/logging';
import {readBoundedBookingForm} from '$lib/server/platform/form-data';
import { env } from '$env/dynamic/private';
import { bookingContextsAvailable } from '$lib/server/sites/public/booking-integration-flags';
import { demoBusinessContext } from '$lib/server/access/public/business';
import { getAvailabilitySlots } from '$lib/server/scheduling/public/availability';
import {
	getHumanAppointmentErrorMessage,
	isAppointmentStatus,
	rescheduleAppointment,
	updateAppointmentStatus
} from '$lib/server/scheduling/public/appointments';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { loadAppointmentBookingContext, loadAppointmentIntakeForPatient } from '$lib/server/sites/public/booking-integrations';
import { processAppointmentGoogleCalendarSync } from '$lib/server/integrations/public/google-calendar';
import { resetPushRemindersForReschedule, sendReschedulePushNotice } from '$lib/server/integrations/public/push';
import {
	buildAppointmentActivationDelivery,
	buildArgentineWaMeUrl,
	buildRescheduleWhatsAppMessage,
	buildWhatsAppWebUrl
} from '$lib/server/scheduling/public/reminders';
import { publicRescheduleUrl } from '$lib/server/integrations/public/messaging';
import { shouldOfferCreatedAppointmentActivation } from '$lib/scheduling/agenda-navigation';
import { normalizeArgentineWhatsAppPhone } from '$lib/utils/phone';
import { classifyUserAgent } from '$lib/device';
import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';
import { isAvailabilityDate } from '$lib/availability/windows';
import { parsePriceQuote } from '$lib/scheduling/price-contracts';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const localDateFor = (isoDate: string, timeZone: string) => {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const parts = Object.fromEntries(formatter.formatToParts(new Date(isoDate)).map((part) => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
};

export const load: PageServerLoad = async ({ params, locals, fetch, cookies, url, request }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const activationDevice = classifyUserAgent(request.headers.get('user-agent'));
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			appointment: null,
			auditLogs: [],
			userLabels: {},
			reprogramDate: new Date().toISOString().slice(0, 10),
			minReprogramDate: new Date().toISOString().slice(0, 10),
			reprogramSlots: [],
			reprogramSlotsLoaded: true,
			fromDate: '',
			justRescheduled: false,
			justCreated: false,
			activationWhatsAppUrl: null,
			activationWhatsAppWebUrl: null,
			activationDevice,
			activationPublicUrl: null,
		phoneWarningAcknowledged: false,
		rescheduleWhatsAppUrl: null,
		rescheduleWhatsAppWebUrl: null,
		reschedulePublicUrl: null,
			demo: true
		};
	}

	const { supabase, business, userId } = await getOdontoContext({
		locals,
		fetch,
		cookies
	});
	const { data, error } = await supabase
		.from('appointments')
		.select(
			'id, business_id, patient_id, service_id, professional_id, starts_at, ends_at, blocking_starts_at, blocking_ends_at, status, source, confirmation_token, service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot, break_minutes_snapshot, ignore_break, confirmed_at, cancelled_at, cancelled_reason, reschedule_requested_at, internal_note, patient_instructions_snapshot, public_reminder_description_snapshot, price_quote_snapshot, phone_communication_status_at_booking, phone_warning_acknowledged_at, created_by_user_id, updated_by_user_id, cancelled_by_user_id, created_at, updated_at, patients(id, full_name, phone_e164, email, blocked)'
		)
		.eq('business_id', business.business.id)
		.eq('id', params.appointmentId)
		.maybeSingle();

	if (error) {
		logServerFailure('Error cargando turno', error);
		throw kitError(
			500,
			'No pudimos cargar el turno. Volvé a la agenda e intentá abrirlo otra vez; si el problema continúa, pedile a un administrador que revise el registro interno.'
		);
	}
	if (!data) {
		throw kitError(
			404,
			'No encontramos ese turno o tu usuario no puede verlo. Volvé a la agenda y comprobá que siga disponible para tu rol.'
		);
	}
 const {data:instructionScope,error:scopeError}=await supabase.rpc('patient_document_in_appointment_scope',{p_business_id:business.business.id,p_appointment_id:data.id,p_actor_id:userId});
 if(scopeError)throw kitError(503,'No pudimos revisar los permisos de las indicaciones. Volvé a intentar.');
 const canEditInstructions=instructionScope===true&&business.access.canUseBusiness;
	const bookingContext = bookingContextsAvailable()
		? await loadAppointmentBookingContext(supabase, data.id) : null;
	const bookingIntake = bookingContext
		? await loadAppointmentIntakeForPatient(supabase, business.business.id, data.id, data.patient_id) : null;

	const appointmentLocalDate = localDateFor(data.starts_at, business.business.timezone);
	const minReprogramDate = todayInTimeZone(business.business.timezone);
	// Dates from the address are used only when they are real dates.
	const requestedReprogramDate = url.searchParams.get('reprogram_date') ?? '';
	const reprogramDate = isAvailabilityDate(requestedReprogramDate)
		? requestedReprogramDate
		: appointmentLocalDate >= minReprogramDate ? appointmentLocalDate : minReprogramDate;
	const requestedFromDate = url.searchParams.get('from_date') ?? '';
	const fromDate = isAvailabilityDate(requestedFromDate) ? requestedFromDate : appointmentLocalDate;

	const [auditResult, usersResult, teamResult] = await Promise.all([
		supabase
			.from('audit_logs')
			.select('id, user_id, action, entity_type, entity_id, metadata, created_at')
			.eq('business_id', business.business.id)
			.eq('entity_type', 'appointment')
			.eq('entity_id', params.appointmentId)
			.order('created_at', { ascending: false }),
		supabase.rpc('list_business_users', { target_business_id: business.business.id }),
		supabase
			.from('appointment_professionals')
			.select(
				'professional_id, position, is_primary, professional_name_snapshot, break_minutes_snapshot'
			)
			.eq('business_id', business.business.id)
			.eq('appointment_id', params.appointmentId)
			.order('position')
	]);

	// Without its team a joint appointment would look like one professional's: an error.
	// The history is secondary, so the page says it could not be loaded instead of
	// showing it as empty; without the users, it names them by their identifier.
	if (teamResult.error) {
		logServerFailure('appointment.team_unavailable', teamResult.error);
		throw kitError(503, 'No pudimos cargar el equipo del turno. Volvé a intentar.');
	}
	if (auditResult.error) logServerFailure('Error cargando auditoria del turno', auditResult.error);
	if (usersResult.error) logServerFailure('Error cargando usuarios para auditoria', usersResult.error);

	const userLabels = Object.fromEntries(
		(usersResult.data ?? []).map((user) => [String(user.user_id), user.email ?? String(user.user_id).slice(0, 8)])
	);

	// Botón "Enviar actualización por WhatsApp": solo si el turno sigue activo, hay un
	// teléfono E.164 plausible y un token. El enlace privado muestra SOLO el aviso de
	// reprogramación. El texto va precargado y neutral (sin datos clínicos).
	const patient = data.patients;
	const phone = normalizeArgentineWhatsAppPhone(patient?.phone_e164);
	const token = data.confirmation_token ? String(data.confirmation_token) : null;
	const canNotifyReschedule = isActiveAppointmentStatus(data.status);
	let rescheduleWhatsAppUrl: string | null = null;
	let rescheduleWhatsAppWebUrl: string | null = null;
	let reschedulePublicUrl: string | null = null;
	if (canNotifyReschedule && token) {
		reschedulePublicUrl = publicRescheduleUrl(token);
		const message = buildRescheduleWhatsAppMessage({
			patientName: String(patient?.full_name ?? 'Paciente'),
			startsAt: String(data.starts_at),
			timezone: business.business.timezone,
			businessName: business.business.name,
			rescheduleUrl: reschedulePublicUrl
		});
		rescheduleWhatsAppUrl = buildArgentineWaMeUrl(
			phone,
			message
		);
		rescheduleWhatsAppWebUrl = phone ? buildWhatsAppWebUrl(phone, message) : null;
	}

	const phoneWarningAcknowledged =
		['missing', 'invalid'].includes(
			String(data.phone_communication_status_at_booking)
		) && Boolean(data.phone_warning_acknowledged_at);
	const justCreated = shouldOfferCreatedAppointmentActivation({
		requested: url.searchParams.get('created') === '1',
		source: String(data.source),
		status: String(data.status),
		startsAt: String(data.starts_at),
		token
	});
	const activation = justCreated && token && !phoneWarningAcknowledged
		? buildAppointmentActivationDelivery(phone, token)
		: null;

	return {
		context: business,canEditInstructions,
		appointment: {
			...data,
			// The quote saved with the booking is JSON: validated here, never trusted as is.
			price_quote_snapshot: parsePriceQuote(data.price_quote_snapshot),
			booking_context: bookingContext,
			booking_intake: bookingIntake,
			professionals:
				teamResult.data && teamResult.data.length > 0
					? teamResult.data
					: [
							{
								professional_id: data.professional_id,
								position: 0,
								is_primary: true,
								professional_name_snapshot: data.professional_name_snapshot,
								break_minutes_snapshot: data.break_minutes_snapshot ?? 0
							}
						]
		},
		auditLogs: auditResult.error ? null : auditResult.data,
		userLabels,
		reprogramDate,
		minReprogramDate,
		reprogramSlots: [],
		reprogramSlotsLoaded: false,
		fromDate,
		justRescheduled: url.searchParams.get('rescheduled') === '1',
		justCreated,
		activationWhatsAppUrl: activation?.whatsappUrl ?? null,
		activationWhatsAppWebUrl: activation?.whatsappWebUrl ?? null,
		activationDevice,
		activationPublicUrl: activation?.publicUrl ?? null,
		phoneWarningAcknowledged,
		rescheduleWhatsAppUrl,
		rescheduleWhatsAppWebUrl,
		reschedulePublicUrl,
		demo: false
	};
};

export const actions: Actions = {
 save_instructions:async event=>{
  if(!event.locals.auth)throw redirect(303,'/login');if(env.DEMO_MODE==='true')return fail(400,{message:'No disponible en modo demo.'});
  const {supabase,business}=await getOdontoContext(event);const form=await readBoundedBookingForm(event.request);
  const {error}=await supabase.rpc('save_appointment_patient_instructions',{p_business_id:business.business.id,p_appointment_id:event.params.appointmentId,p_expected_updated_at:String(form.get('updated_at')??''),p_instructions:String(form.get('instructions')??''),p_public_description:String(form.get('public_description')??'')});
  if(error)return fail(409,{message:error.message.includes('CARE_CONFIGURATION_CHANGED')?'El turno cambió. Recargá la página antes de guardar las indicaciones.':'No pudimos guardar las indicaciones. Revisá tu permiso y la extensión de los textos.'});return {success:true,message:'Las indicaciones de este turno quedaron guardadas.'};
 },
	update_status: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });

		const form = await request.formData();
		const status = String(form.get('status') ?? '').trim();
		if (!isAppointmentStatus(status)) return fail(400, { message: 'Estado inválido.' });
		if (status === 'confirmed') {
			return fail(400, { message: 'La confirmación queda reservada al paciente desde su enlace.' });
		}

		if (!business.canOperate) {
			return fail(403, { message: 'No tenés permiso para modificar este turno.' });
		}

		try {
			await updateAppointmentStatus(supabase, {
				businessId: business.business.id,
				appointmentId: params.appointmentId,
				status,
				userId,
				reason: String(form.get('reason') ?? '').trim() || null
			});
		} catch (error) {
			logServerFailure('Error actualizando turno', error);
			return fail(400, { message: getHumanAppointmentErrorMessage(error) });
		}

		if (status === 'cancelled') {
			try {
				const admin = await createSupabaseAdminClient('odonto', fetch);
				await processAppointmentGoogleCalendarSync(admin, params.appointmentId, fetch);
			} catch (calendarError) {
				// El trigger ya dejó el borrado en la cola durable.
				logServerFailure('Error sincronizando Google Calendar tras cancelar turno', {
					appointmentId: params.appointmentId,
					code:
						calendarError instanceof Error
							? calendarError.message.slice(0, 120)
							: 'unknown'
				});
			}
		}

		return { success: true, message: 'Turno actualizado.' };
	},
	reschedule: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) {
			return fail(403, {
				message:
					'Tu rol no permite reprogramar turnos. Pedile a recepción, al dueño o a un administrador que haga el cambio desde la agenda.'
			});
		}

		const form = await request.formData();
		const slotStartsAt = String(form.get('slot_starts_at') ?? '').trim();
		const reprogramDate = String(form.get('reprogram_date') ?? '').trim();
		const ignoreBreak = form.get('ignore_break') === 'true';
		if (!slotStartsAt || !reprogramDate) {
			return fail(400, {
				message:
					'Elegí una fecha y uno de los horarios que muestra la agenda antes de confirmar la reprogramación.'
			});
		}
		if (reprogramDate < todayInTimeZone(business.business.timezone)) {
			return fail(400, {
				message:
					'No se puede mover un turno a una fecha pasada. Elegí hoy o una fecha futura y seleccioná un horario disponible.'
			});
		}

		const [appointmentResult, teamResult] = await Promise.all([
			supabase
				.from('appointments')
				.select('id, service_id, professional_id, status, ignore_break')
				.eq('business_id', business.business.id)
				.eq('id', params.appointmentId)
				.maybeSingle(),
			supabase
				.from('appointment_professionals')
				.select('professional_id, position')
				.eq('business_id', business.business.id)
				.eq('appointment_id', params.appointmentId)
				.order('position')
		]);
		const appointment = appointmentResult.data;
		if (appointmentResult.error || teamResult.error) {
			logServerFailure('Error cargando turno o equipo para reprogramar', appointmentResult.error ?? teamResult.error);
			return fail(500, {
				message:
					'No pudimos cargar el turno completo y, por seguridad, no modificamos ninguna agenda. Recargá la página y volvé a intentar.'
			});
		}
		if (!appointment) {
			return fail(404, {
				message:
					'No encontramos el turno que querés reprogramar. Volvé a la agenda y abrilo nuevamente.'
			});
		}
		const professionalIds =
			teamResult.data && teamResult.data.length > 0
				? teamResult.data.map((allocation) => String(allocation.professional_id))
				: [String(appointment.professional_id)];

		let slots;
		try {
			slots = await getAvailabilitySlots(supabase, {
				business: business.business,
				serviceId: appointment.service_id,
				professionalId: professionalIds.length === 1 ? professionalIds[0] : null,
				professionalIds: professionalIds.length > 1 ? professionalIds : [],
				fromDate: reprogramDate,
				toDate: reprogramDate,
				publicOnly: false,
				excludeAppointmentId: appointment.id,
				ignoreBreak
			});
		} catch (availabilityError) {
			logServerFailure('Error revalidando equipo antes de reprogramar', availabilityError);
			return fail(500, {
				message:
					'No pudimos volver a comprobar la disponibilidad de todo el equipo y, por seguridad, el turno conserva su horario anterior. Recargá la página y volvé a intentar.'
			});
		}
		const slot = slots.find((candidate) => candidate.starts_at === slotStartsAt);
		if (!slot) {
			return fail(409, {
				message:
					professionalIds.length > 1
						? 'Ese horario ya no está disponible para todo el equipo. No se modificó ninguna agenda. Actualizá los horarios y elegí otra opción conjunta.'
						: 'Ese horario dejó de estar disponible. El turno conserva su fecha anterior. Actualizá los horarios y elegí otra opción.'
			});
		}

		try {
			await rescheduleAppointment(supabase, {
				businessId: business.business.id,
				appointmentId: params.appointmentId,
				userId,
				startsAt: new Date(slot.starts_at),
				ignoreBreak
			});
		} catch (error) {
			logServerFailure('Error reprogramando turno', error);
			return fail(400, { message: getHumanAppointmentErrorMessage(error) });
		}

		// Invalida los avisos push del horario viejo (redundante con el trigger de BD
		// appointments_reset_push_reminders: acá queda como refuerzo) y manda el aviso
		// inmediato de reprogramación, que además pisa la notificación vieja que pudiera
		// seguir visible en el navegador del paciente. push_subscriptions es service-role
		// only (RLS sin policies), por eso va con cliente admin. Best-effort: el turno ya
		// quedó reprogramado, así que un fallo acá no debe abortar la acción.
		try {
			const admin = await createSupabaseAdminClient('odonto', fetch);
			// El trigger de base de datos ya hace este reseteo dentro de la transacción.
			// Este refuerzo no puede bloquear el aviso inmediato si falla por separado.
			try {
				await resetPushRemindersForReschedule(admin, {
					businessId: business.business.id,
					appointmentId: params.appointmentId
				});
			} catch (resetError) {
				logServerFailure('Error reforzando el reseteo de avisos tras reprogramar', resetError);
			}
			try {
				await sendReschedulePushNotice(admin, fetch, {
					businessId: business.business.id,
					appointmentId: params.appointmentId
				});
			} catch (noticeError) {
				logServerFailure('Error enviando el aviso inmediato tras reprogramar', noticeError);
			}
		} catch (pushSetupError) {
			logServerFailure('Error preparando avisos push tras reprogramar', pushSetupError);
		}

		try {
			const admin = await createSupabaseAdminClient('odonto', fetch);
			await processAppointmentGoogleCalendarSync(admin, params.appointmentId, fetch);
		} catch (calendarError) {
			// La reprogramacion ya quedó confirmada y la cola reintentará sin intervención.
			logServerFailure('Error sincronizando Google Calendar tras reprogramar', {
				appointmentId: params.appointmentId,
				code:
					calendarError instanceof Error
						? calendarError.message.slice(0, 120)
						: 'unknown'
			});
		}

		throw redirect(
			303,
			`/odonto/turnos/${params.appointmentId}?from_date=${slot.date}&reprogram_date=${slot.date}&rescheduled=1`
		);
	}
};

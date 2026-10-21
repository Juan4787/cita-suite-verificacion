import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { randomUUID } from 'crypto';
import { demoBusinessContext } from '$lib/server/access/public/business';
import { getAvailabilitySlots, zonedDateTimeToUtc } from '$lib/server/scheduling/public/availability';
import {
	defaultInternalAvailabilitySnapshotRange,
	loadInternalAvailabilitySnapshot
} from '$lib/server/scheduling/public/availability-snapshot';
import {
	APPOINTMENT_STATUSES,
	createJointAppointment,
	createManualAppointment,
	findAppointmentCreationReplay,
	getHumanAppointmentErrorMessage,
	getAppointmentCreationErrorStatus,
	isAppointmentStatus,
	updateAppointmentStatus
} from '$lib/server/scheduling/public/appointments';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { countTomorrowUncovered } from '$lib/server/scheduling/public/reminders';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { processAppointmentGoogleCalendarSync } from '$lib/server/integrations/public/google-calendar';
import { createdAppointmentDetailUrl } from '$lib/scheduling/agenda-navigation';
import { todayInTimeZone } from '$lib/availability/calculate';
import { isAvailabilityDate } from '$lib/availability/windows';
import { isUuid } from '@cita-suite/shared/uuid';
import {
	ACTIVE_APPOINTMENT_STATUSES,
	isActiveAppointmentStatus
} from '$lib/utils/appointment-visibility';
import { resolveCommunicationPhoneDecision } from '$lib/utils/communication-phone';
import { isRecord } from '$lib/contracts/json';
import type { CitaRow } from '$lib/types/database';
import type { AvailabilitySnapshot } from '$lib/availability/snapshot';
import { error, fail, redirect, isRedirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';


const APPOINTMENT_COLUMNS =
	'id, patient_id, service_id, professional_id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot, internal_note, cancelled_reason, patients(full_name, phone_e164, dni, email)';

// Tope de próximos turnos al buscar con "Cualquier día".
const ANY_DAY_LIMIT = 100;


export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const appointmentRequestId = randomUUID();
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			date: todayInTimeZone(demoBusinessContext().business.timezone),
			anyDay: false,
			anyDayLimited: false,
			selectedProfessionalId: '',
			selectedStatus: '',
			selectedServiceId: '',
			selectedPatientId: '',
			searchApplied: false,
			appointments: [],
			stats: APPOINTMENT_STATUSES.map((status) => ({ status, count: 0 })),
			totalAppointments: 0,
			professionals: [],
			services: [],
			serviceProfessionalIds: {},
			availabilitySnapshot: null,
			patients: [],
			patientsLoaded: true,
			referencesLoaded: true,
			reminderCount: 0,
			appointmentRequestId,
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({
		locals,
		fetch,
		cookies
	});
	if (business.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	const dateParam = String(url.searchParams.get('date') ?? '').trim();
	const anyDay = dateParam === 'any';
	// A date that does not exist falls back to the practice's today: JavaScript would
	// silently move "2026-02-31" to March, listing another day under its label.
	const date = !anyDay && isAvailabilityDate(dateParam) ? dateParam : todayInTimeZone(business.business.timezone);
	const professionalId = url.searchParams.get('professional_id') ?? '';
	const requestedStatus = url.searchParams.get('status') ?? '';
	const status = anyDay && !isActiveAppointmentStatus(requestedStatus) ? '' : requestedStatus;
	const serviceId = url.searchParams.get('service_id') ?? '';
	const patientId = url.searchParams.get('patient_id') ?? '';
	const searchApplied =
		url.searchParams.has('date') || Boolean(professionalId || status || serviceId || patientId);
	const reminderCountPromise = (async () => {
		try {
			const pushSubscriptionsSupabase = await createSupabaseAdminClient('odonto', fetch);
			return await countTomorrowUncovered(supabase, business.business, {
				pushSubscriptionsSupabase
			});
		} catch (reminderError) {
			// Unknown, not zero: the page says it could not check them.
			logServerFailure('Error contando recordatorios pendientes', reminderError);
			return null;
		}
	})();

	const appointmentQuery = () => {
		const selected = professionalId
			? supabase.from('appointments').select(`${APPOINTMENT_COLUMNS}, appointment_professionals!inner(professional_id)` as const)
				.eq('appointment_professionals.professional_id', professionalId)
			: supabase.from('appointments').select(APPOINTMENT_COLUMNS);
		return selected.eq('business_id', business.business.id);
	};
	type AgendaAppointment = NonNullable<Awaited<ReturnType<typeof appointmentQuery>>['data']>[number];
	let dayAppointments: AgendaAppointment[] | null = null;
	let appointmentsError: unknown = null;
	let anyDayLimited = false;
	if (anyDay) {
		// "Cualquier día" es una vista operativa: sólo devuelve próximos turnos activos.
		// Los registros históricos siguen disponibles al elegir explícitamente una fecha pasada.
		const baseQuery = () => {
			let builder = appointmentQuery();
			if (serviceId) builder = builder.eq('service_id', serviceId);
			if (patientId) builder = builder.eq('patient_id', patientId);
			if (status) builder = builder.eq('status', status);
			return builder;
		};
		const nowIso = new Date().toISOString();
		const upcomingResult = await baseQuery()
			.in('status', [...ACTIVE_APPOINTMENT_STATUSES])
			.gte('starts_at', nowIso)
			.order('starts_at')
			.limit(ANY_DAY_LIMIT);
		appointmentsError = upcomingResult.error;
		const upcoming = upcomingResult.data ?? [];
		anyDayLimited = upcoming.length === ANY_DAY_LIMIT;
		dayAppointments = upcoming;
	} else {
		const dayStart = zonedDateTimeToUtc(date, '00:00', business.business.timezone);
		const dayEnd = zonedDateTimeToUtc(date, '23:59', business.business.timezone);
		({ data: dayAppointments, error: appointmentsError } = await appointmentQuery()
			.gte('starts_at', dayStart.toISOString())
			.lte('starts_at', dayEnd.toISOString())
			.order('starts_at'));
	}
	// An unreadable day, or references that cannot be read, is an error: never an empty
	// day or a practice that looks as if it had no professionals or services yet.
	const unavailable = (cause: unknown): never => {
		logServerFailure('agenda.day_unavailable', cause);
		error(503, 'No pudimos cargar la agenda. Volvé a intentar.');
	};
	if (appointmentsError) unavailable(appointmentsError);

	const filteredAppointments = (dayAppointments ?? []).filter((appointment) => {
		if (serviceId && appointment.service_id !== serviceId) return false;
		if (patientId && appointment.patient_id !== patientId) return false;
		if (status && appointment.status !== status) return false;
		return true;
	});

	const stats = APPOINTMENT_STATUSES.map((appointmentStatus) => ({
		status: appointmentStatus,
		count: filteredAppointments.filter((appointment) => appointment.status === appointmentStatus).length
	}));

	const shouldLoadReferences = Boolean(professionalId || serviceId || patientId);
	let professionals: AvailabilitySnapshot['professionals'] = [];
	let services: AvailabilitySnapshot['services'] = [];
	let patients: Pick<CitaRow<'patients'>, 'id' | 'full_name' | 'phone' | 'phone_raw' | 'phone_e164' | 'dni' | 'birth_date' | 'activity_at' | 'blocked'>[] = [];
	let assignments: AvailabilitySnapshot['assignments'] = [];
	let availabilitySnapshot = null;
	if (shouldLoadReferences) {
		try {
			const range = defaultInternalAvailabilitySnapshotRange(business.business, date);
			availabilitySnapshot = await loadInternalAvailabilitySnapshot(supabase, {
				business: business.business,
				...range
			});
			professionals = availabilitySnapshot.professionals;
			services = availabilitySnapshot.services;
			assignments = availabilitySnapshot.assignments;
		} catch (cause) {
			unavailable(cause);
		}
	}
	const appointments = filteredAppointments;

	const serviceProfessionalIds = (assignments ?? []).reduce<Record<string, string[]>>((acc, assignment) => {
		const service = String(assignment.service_id);
		acc[service] = acc[service] ?? [];
		acc[service].push(String(assignment.professional_id));
		return acc;
	}, {});

	// El aviso usa el criterio exacto de Recordatorios: sólo cuenta los turnos sin
	// calendario, avisos activados ni cobertura automática.
	const reminderCount = await reminderCountPromise;

	if (patientId) {
		const { data: selectedPatient, error: patientError } = await supabase
			.from('patients')
			.select('id, full_name, phone, phone_raw, phone_e164, dni, birth_date, activity_at, blocked')
			.eq('business_id', business.business.id)
			.eq('id', patientId)
			.maybeSingle();
		if (patientError) unavailable(patientError);
		if (selectedPatient) patients = [selectedPatient];
	}

	return {
		context: business,
		date,
		anyDay,
		anyDayLimited,
		selectedProfessionalId: professionalId,
		selectedStatus: status,
		selectedServiceId: serviceId,
		selectedPatientId: patientId,
		searchApplied,
		appointments: appointments ?? [],
		stats,
		totalAppointments: (dayAppointments ?? []).length,
		professionals: professionals ?? [],
		services: services ?? [],
		serviceProfessionalIds,
		availabilitySnapshot,
		patients,
		patientsLoaded: false,
		referencesLoaded: shouldLoadReferences,
		reminderCount,
		appointmentRequestId,
		demo: false
	};
};

export const actions: Actions = {
	create_appointment: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para crear turnos.' });

		const form = await request.formData();
		const serviceId = String(form.get('service_id') ?? '').trim();
		const requestedProfessionalIds = [
			...new Set(
				[
					...form.getAll('professional_ids').map((value) => String(value).trim()),
					String(form.get('professional_id') ?? '').trim()
				].filter(Boolean)
			)
		];
		const bookingMode =
			String(form.get('booking_mode') ?? '').trim() === 'joint' ||
			requestedProfessionalIds.length > 1
				? 'joint'
				: 'individual';
		const professionalIds =
			bookingMode === 'joint'
				? requestedProfessionalIds
				: requestedProfessionalIds.slice(0, 1);
		const professionalId = professionalIds[0] ?? '';
		const date = String(form.get('date') ?? '').trim();
		const time = String(form.get('time') ?? '').trim();
		const patientId = String(form.get('patient_id') ?? '').trim();
		const patientMode = String(form.get('patient_mode') ?? '').trim();
		const patientName = String(form.get('patient_name') ?? '').trim();
		const patientPhone = String(form.get('patient_phone') ?? '').trim();
		const patientEmail = String(form.get('patient_email') ?? '').trim();
		const patientPhoneChanged = form.get('patient_phone_changed') === 'true';
		const phoneWarningOverride = String(form.get('phone_warning_override') ?? '').trim();
		const idempotencyKey = String(form.get('idempotency_key') ?? '').trim();
		const ignoreBreak = form.get('ignore_break') === 'true';
		const values = {
			...Object.fromEntries(form),
			booking_mode: bookingMode,
			patient_mode: patientMode,
			professional_id: professionalId,
			professional_ids: professionalIds.join(',')
		};

		if (!serviceId || !professionalId || !date || !time) {
			return fail(400, {
				message:
					'Falta información para crear el turno. Volvé al asistente y completá el procedimiento, los profesionales, la fecha y el horario antes de confirmar.',
				values
			});
		}
		if (bookingMode === 'joint' && professionalIds.length < 2) {
			return fail(400, {
				message:
					'Un turno conjunto necesita por lo menos dos profesionales diferentes. Volvé al paso del equipo, seleccioná dos o más integrantes y buscá nuevamente un horario.',
				values
			});
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
			return fail(400, {
				message:
					'La fecha o la hora no tienen un formato válido. Volvé al paso de horarios y elegí una opción mostrada por la agenda.',
				values
			});
		}
		if (patientMode !== 'existing' && patientMode !== 'new') {
			return fail(400, {
				message:
					'La selección del paciente quedó incompleta. Volvé al último paso y elegí “Buscar paciente” o “Nuevo paciente”.',
				values
			});
		}
		if (patientMode === 'existing' && (!patientId || patientName)) {
			return fail(400, {
				message:
					'Para usar una ficha existente, buscá y seleccioná al paciente otra vez antes de confirmar.',
				values
			});
		}
		if (patientMode === 'new' && (patientId || !patientName)) {
			return fail(400, {
				message:
					'Para crear una ficha nueva, elegí “Nuevo paciente” y completá el nombre antes de confirmar.',
				values
			});
		}
		if (!isUuid(idempotencyKey)) {
			return fail(400, {
				message:
					'La sesión para crear el turno venció. Cerrá el asistente, abrilo nuevamente y volvé a confirmar.',
				values
			});
		}

		let admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
		try {
			admin = await createSupabaseAdminClient('odonto', fetch);
		} catch (adminError) {
			logServerFailure('Error preparando la creación del turno', adminError);
			return fail(500, { message: 'No pudimos preparar el turno. Intentá de nuevo.', values });
		}

			let effectivePatientPhone = patientPhone;
			let selectedPatientBlocked = false;
			let selectedPatientArchived = false;
			if (patientMode === 'existing') {
			const { data: selectedPatient, error: selectedPatientError } = await admin
				.from('patients')
				.select('id, blocked, archived_at, phone, phone_raw, phone_e164')
				.eq('business_id', business.business.id)
				.eq('id', patientId)
				.maybeSingle();
			if (selectedPatientError) {
				logServerFailure('Error validando el teléfono del paciente', selectedPatientError);
				return fail(500, { message: 'No pudimos comprobar el teléfono. Intentá de nuevo.', values });
			}
			if (!selectedPatient) {
				return fail(404, { message: 'No encontramos al paciente seleccionado.', values });
			}
				selectedPatientBlocked = Boolean(selectedPatient.blocked);
				selectedPatientArchived = Boolean(selectedPatient.archived_at);
			if (!patientPhoneChanged) {
				effectivePatientPhone = String(
					selectedPatient.phone_raw ?? selectedPatient.phone ?? selectedPatient.phone_e164 ?? ''
				).trim();
			}
		}

		const phoneDecision = resolveCommunicationPhoneDecision(
			effectivePatientPhone,
			phoneWarningOverride
		);
		if (phoneDecision.warning) {
			return fail(422, {
				phoneWarning: { kind: phoneDecision.warning },
				values: {
					...values,
					patient_phone: effectivePatientPhone,
					patient_phone_changed: patientPhoneChanged ? 'true' : 'false',
					phone_warning_override: ''
				}
			});
			}
			const startsAt = zonedDateTimeToUtc(date, time, business.business.timezone);
			const patient =
				patientMode === 'existing'
					? {
							mode: 'existing' as const,
							patientId,
							phone: effectivePatientPhone,
							updatePhone: patientPhoneChanged
						}
					: {
							mode: 'new' as const,
							name: patientName,
							phone: effectivePatientPhone,
							email: patientEmail
						};
			const commonInput = {
				businessId: business.business.id,
				ownerId: userId,
				createdByUserId: userId,
				patient,
				serviceId,
				professionalIds,
				startsAt,
				internalNote: String(form.get('internal_note') ?? '').trim() || null,
				ignoreBreak,
				phoneCommunicationStatus: phoneDecision.status,
				phoneWarningAcknowledged: phoneDecision.acknowledged,
				idempotencyKey
			};

			try {
				const replay = await findAppointmentCreationReplay(admin, commonInput);
				if (replay) throw redirect(303, createdAppointmentDetailUrl(replay.id, date));
			} catch (error) {
				if (isRedirect(error)) throw error;
				logServerFailure('Error recuperando un turno ya creado', error);
				return fail(getAppointmentCreationErrorStatus(error), { message: getHumanAppointmentErrorMessage(error), values });
			}
			if (selectedPatientBlocked) {
				return fail(400, { message: 'Ese paciente está bloqueado.', values });
			}
			if (selectedPatientArchived) {
				return fail(400, {
					message:
						'La ficha seleccionada está archivada. Restaurala desde Pacientes o elegí otra ficha activa.',
					values
				});
			}

			let slots;
		try {
			slots = await getAvailabilitySlots(supabase, {
				business: business.business,
				serviceId,
				professionalId: bookingMode === 'individual' ? professionalId : null,
				professionalIds: bookingMode === 'joint' ? professionalIds : [],
				fromDate: date,
				toDate: date,
				publicOnly: false,
				ignoreBreak
			});
		} catch (availabilityError) {
			logServerFailure('Error revalidando disponibilidad antes de crear turno', availabilityError);
			return fail(500, {
				message:
					'No pudimos volver a comprobar la disponibilidad y, por seguridad, no reservamos a ningún profesional. Recargá la agenda y elegí el horario otra vez.',
				values
			});
		}
		if (
			!slots.some(
				(slot) =>
					slot.starts_at === startsAt.toISOString() &&
					(bookingMode === 'joint'
						? professionalIds.every((id) => slot.professional_ids?.includes(id))
						: slot.professional_id === professionalId)
			)
		) {
			return fail(409, {
				message:
					bookingMode === 'joint'
						? 'Ese horario ya no está libre para todo el equipo. No se reservó a ningún profesional. Volvé al paso de horarios, actualizá la disponibilidad conjunta y elegí una de las opciones que siguen visibles.'
						: 'Ese horario ya no está libre para el profesional seleccionado. No se creó el turno. Volvé al paso de horarios, actualizá la disponibilidad y elegí otra opción.',
				values
			});
		}

			try {
				const created =
					bookingMode === 'joint'
						? await createJointAppointment(admin, {
								...commonInput,
								professionalIds: commonInput.professionalIds
							})
						: await createManualAppointment(admin, {
								...commonInput,
								professionalId
							});
			throw redirect(303, createdAppointmentDetailUrl(created.id, date));
		} catch (error) {
			if (isRedirect(error)) throw error;
			logServerFailure('Error creando turno', error);
			const message = getHumanAppointmentErrorMessage(error);
			return fail(getAppointmentCreationErrorStatus(error), { message, values });
		}
	},
	update_status: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para modificar turnos.' });

		const form = await request.formData();
		const appointmentId = String(form.get('appointment_id') ?? '').trim();
		const status = String(form.get('status') ?? '').trim();
		const requestedDate = String(form.get('date') ?? '').trim();
		const date = isAvailabilityDate(requestedDate) ? requestedDate : todayInTimeZone(business.business.timezone);
		const professionalId = String(form.get('professional_id') ?? '').trim();
		const selectedStatus = String(form.get('selected_status') ?? '').trim();
		const serviceId = String(form.get('service_id') ?? '').trim();
		if (!appointmentId || !isAppointmentStatus(status)) {
			return fail(400, {
				message:
					'No pudimos identificar el turno o el estado solicitado. Recargá la agenda y usá una de las acciones visibles en la tarjeta del turno.'
			});
		}
		if (status === 'confirmed') {
			return fail(400, { message: 'La confirmación queda reservada al paciente desde su enlace.' });
		}

		try {
			await updateAppointmentStatus(supabase, {
				businessId: business.business.id,
				appointmentId,
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
				await processAppointmentGoogleCalendarSync(admin, appointmentId, fetch);
			} catch (calendarError) {
				// El borrado remoto ya quedó encolado por el trigger transaccional.
				logServerFailure('Error sincronizando Google Calendar tras cancelar desde agenda', {
					appointmentId,
					code:
						calendarError instanceof Error
							? calendarError.message.slice(0, 120)
							: 'unknown'
				});
			}
		}

		const params = new URLSearchParams({ date });
		if (professionalId) params.set('professional_id', professionalId);
		if (selectedStatus) params.set('status', selectedStatus);
		if (serviceId) params.set('service_id', serviceId);
		throw redirect(303, `/odonto/agenda?${params.toString()}`);
	}
};

import { FORM_PAGE_REFERRER_POLICY } from '$lib/server/platform/cross-site-form';
import type { CitaSupabaseClient } from '$lib/types/database';
import { loadAppointmentEmailDeliveries, resolveAppointmentEmailDelivery } from '$lib/server/scheduling/public/email-status';
import { todayInTimeZone } from '$lib/availability/calculate';
import { logServerFailure } from '$lib/server/platform/logging';
import {readBoundedBookingForm} from '$lib/server/platform/form-data';
import { env } from '$env/dynamic/private';
import { bookingContextsAvailable } from '$lib/server/sites/public/booking-integration-flags';
import { demoBusinessContext } from '$lib/server/access/public/business';
import { parseStaffManagementSelection } from '$lib/server/scheduling/public/staff-management';
import { submitStaffManagementAction } from '$lib/server/scheduling/public/staff-management-flow';
import { parseStaffDepositFinancials, submitLateDepositAction } from '$lib/server/scheduling/public/late-deposits';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { loadAppointmentBookingContext, loadAppointmentIntakeForPatient } from '$lib/server/sites/public/booking-integrations';
import { processAppointmentGoogleCalendarSync } from '$lib/server/integrations/public/google-calendar';
import { sendReschedulePushNotice } from '$lib/server/integrations/public/push';
import { prepareStaffDelivery, staffDeliveryFailure } from '$lib/server/scheduling/public/staff-delivery';
import { shouldOfferCreatedAppointmentActivation } from '$lib/scheduling/agenda-navigation';
import { normalizeArgentineWhatsAppPhone } from '$lib/utils/phone';
import { classifyUserAgent, whatsappHrefFor }  from '$lib/device';
import { isUpcomingActiveAppointment } from '$lib/utils/appointment-visibility';
import { isAvailabilityDate } from '$lib/availability/windows';
import { parsePriceQuote } from '$lib/scheduling/price-contracts';
import { isUuid } from '@cita-suite/shared/uuid';
import { parseAppointmentDeposit, parsePatientDepositCredits, type PatientDepositCredit } from '$lib/scheduling/deposits';
import {
	DEPOSIT_ACTIONS,
	DepositError,
	applyPatientDepositCredit,
	clearAppointmentDepositPaymentNotice,
	getDepositErrorMessage,
	getDepositErrorStatus,
	setAppointmentDeposit,
	type DepositAction
} from '$lib/server/scheduling/public/deposits';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// Who records deposits; the database enforces the same roles and the practice's state.
const DEPOSIT_ROLES = new Set(['owner', 'admin', 'reception']);

// A to-one relation as the generated types describe it: never a list.
type OneToOne<T> = T extends readonly unknown[] ? never : T;

const DEPOSIT_SUCCESS: Record<DepositAction, (appointmentStatus: string) => string> = {
	paid: () => 'Seña confirmada. El turno quedó Confirmado.',
	waived: () => 'Seña exceptuada. El turno quedó Confirmado.',
	pending: (appointmentStatus) =>
		appointmentStatus === 'reserved'
			? 'Se deshizo el registro de la seña. El turno volvió a Reservado.'
			: 'Se deshizo el registro de la seña. La seña volvió a pendiente.'
};

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

// Secondary information: its failure must not take the appointment page down with it.
const emailDeliveriesFor = async (supabase: CitaSupabaseClient, businessId: string, appointmentId: string) => {
	try {
		return await loadAppointmentEmailDeliveries(supabase, businessId, appointmentId);
	} catch (cause) {
		logServerFailure('Error cargando los correos del turno', cause);
		return null;
	}
};

export const load: PageServerLoad = async ({ params, locals, fetch, cookies, url, request }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const activationDevice = classifyUserAgent(request.headers.get('user-agent'));
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			appointment: null,
            management: null,
			deposit: null,
   depositFinancials: null,
			depositCreditCutoffHours: null as number | null,
			availableDepositCredits: [] as PatientDepositCredit[],
			nowIso: new Date().toISOString(),
			canRecordDeposit: false,
			auditLogs: [],
			emailDeliveries: null,
			userLabels: {},
			reprogramDate: new Date().toISOString().slice(0, 10),
			minReprogramDate: new Date().toISOString().slice(0, 10),
			reprogramSlots: [],
			reprogramSlotsLoaded: true,
			fromDate: '',
			justRescheduled: false,
			justCreated: false,
   delivery: { available: false, hasPhone: false },
   activationDevice,
   phoneWarningAcknowledged: false,
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
			'id, business_id, patient_id, service_id, professional_id, starts_at, ends_at, blocking_starts_at, blocking_ends_at, status, source, service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot, break_minutes_snapshot, ignore_break, confirmed_at, cancelled_at, cancelled_reason, reschedule_requested_at, internal_note, patient_instructions_snapshot, public_reminder_description_snapshot, price_quote_snapshot, phone_communication_status_at_booking, phone_warning_acknowledged_at, created_by_user_id, updated_by_user_id, cancelled_by_user_id, created_at, updated_at, appointment_management_revision, appointment_deposit_financials, appointment_professionals(professional_id, position, is_primary, professional_name_snapshot, break_minutes_snapshot), patients(id, full_name, phone_e164, email, blocked, archived_at, patient_available_deposit_credits), appointment_deposits(appointment_id, status, amount, currency, request_from, due_at, auto_cancel, waived_reason, recorded_at, reminder_opened_at, expired_at, revision, patient_payment_notice_at, applied_credit_id, applied_credit_amount, amount_difference_note)'
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
	let selection;
 try { selection = parseStaffManagementSelection(data); }
 catch (error) { logServerFailure('appointment.management_selection_unavailable', error); throw kitError(503, 'No pudimos cargar el turno completo. Volvé a intentar.'); }
 let financials;
 try { financials = parseStaffDepositFinancials(data.appointment_deposit_financials); }
 catch (error) { logServerFailure('Error cargando los importes registrados del turno',error); throw kitError(503,'No pudimos cargar los importes del turno. Volvé a intentar antes de registrar dinero.'); }
 const { appointment_deposit_financials: _financials, appointment_deposits: depositRelation, appointment_professionals: team, patients: patientWithCredits, ...appointmentRow } = data;
	const depositRow: OneToOne<typeof depositRelation> = depositRelation;
	const deposit = parseAppointmentDeposit(depositRow ?? null);
	const availableDepositCredits = parsePatientDepositCredits(patientWithCredits?.patient_available_deposit_credits);
	const patientSummary = patientWithCredits
		? {
				id: patientWithCredits.id,
				full_name: patientWithCredits.full_name,
				phone_e164: patientWithCredits.phone_e164,
				email: patientWithCredits.email,
				blocked: patientWithCredits.blocked,
				archived_at: patientWithCredits.archived_at
			}
		: null;
	// It cancels itself only with its own snapshot and the practice's switch both on (and no patient
	// payment notice); unknown is said as unknown, never as «no».
	let depositCancelsItself: boolean | null = null;
	let depositCreditCutoffHours: number | null = null;
	if (deposit) {
		const { data: depositPolicy, error: depositPolicyError } = await supabase
			.from('deposit_policies')
			.select('auto_cancel_enabled, deposit_credit_cutoff_hours')
			.eq('business_id', business.business.id)
			.maybeSingle();
		if (depositPolicyError) logServerFailure('Error cargando la política de señas del turno', depositPolicyError);
		else {
			depositCancelsItself =
				deposit.auto_cancel &&
				!deposit.patient_payment_notice_at &&
				depositPolicy?.auto_cancel_enabled === true;
			depositCreditCutoffHours = depositPolicy?.deposit_credit_cutoff_hours ?? null;
		}
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

	const [auditResult, usersResult] = await Promise.all([
		supabase
			.from('audit_logs')
			.select('id, user_id, action, entity_type, entity_id, metadata, created_at')
			.eq('business_id', business.business.id)
			.eq('entity_type', 'appointment')
			.eq('entity_id', params.appointmentId)
			.order('created_at', { ascending: false }),
		supabase.rpc('list_business_users', { target_business_id: business.business.id })
	]);

	if (auditResult.error) logServerFailure('Error cargando auditoria del turno', auditResult.error);
	if (usersResult.error) logServerFailure('Error cargando usuarios para auditoria', usersResult.error);

	const userLabels = Object.fromEntries(
		(usersResult.data ?? []).map((user) => [String(user.user_id), user.email || 'Una persona del equipo'])
	);

 // A load supplies eligibility, never a bearer credential or a prepared message.
 const deliveryAvailable = business.canOperate && DEPOSIT_ROLES.has(business.role) && isUpcomingActiveAppointment(data)
  && Boolean(data.patients && !data.patients.blocked && data.patients.archived_at === null);
 const delivery = { available: deliveryAvailable, hasPhone: Boolean(normalizeArgentineWhatsAppPhone(data.patients?.phone_e164)) };

	const phoneWarningAcknowledged =
		['missing', 'invalid'].includes(
			String(data.phone_communication_status_at_booking)
		) && Boolean(data.phone_warning_acknowledged_at);
	const justCreated = shouldOfferCreatedAppointmentActivation({
		requested: url.searchParams.get('created') === '1',
		source: String(data.source),
		status: String(data.status),
		startsAt: String(data.starts_at),
  canPrepareLink: deliveryAvailable
	});

	return {
		context: business,canEditInstructions,
  management: { revision: selection.revision, statusOperationId: crypto.randomUUID(), rescheduleOperationId: crypto.randomUUID(), lateDepositOperationId: crypto.randomUUID() },
  depositFinancials: { ...financials, latePayments: financials.latePayments.map(row => ({ ...row,correctionOperationId: crypto.randomUUID() })) },
		appointment: {
			...appointmentRow,
			patients: patientSummary,
			// The quote saved with the booking is JSON: validated here, never trusted as is.
			price_quote_snapshot: parsePriceQuote(data.price_quote_snapshot),
			booking_context: bookingContext,
			booking_intake: bookingIntake,
			professionals: [...team].sort((a,b) => a.position - b.position)
		},
		deposit: deposit ? { ...deposit, cancelsItself: depositCancelsItself } : null,
		depositCreditCutoffHours,
		availableDepositCredits,
		nowIso: new Date().toISOString(),
		canRecordDeposit: business.canOperate && DEPOSIT_ROLES.has(business.role),
		auditLogs: auditResult.error ? null : auditResult.data,
		// Only the roles the database lets read it: anyone else would just produce a refused call.
		emailDeliveries: business.canOperate && DEPOSIT_ROLES.has(business.role) ? await emailDeliveriesFor(supabase, business.business.id, params.appointmentId) : null,
		userLabels,
		reprogramDate,
		minReprogramDate,
		reprogramSlots: [],
		reprogramSlotsLoaded: false,
		fromDate,
		justRescheduled: deliveryAvailable && url.searchParams.get('rescheduled') === '1',
		justCreated,
  delivery,
  activationDevice,
  phoneWarningAcknowledged,
		demo: false
	};
};

export const actions: Actions = {
 late_deposit: async event => {
  if (!event.locals.auth) throw redirect(303,'/login');
  if (env.DEMO_MODE === 'true') return fail(400,{ message: 'No disponible en modo demo.' });
  if (!isUuid(event.params.appointmentId)) return fail(404,{ message: 'No encontramos ese turno.' });
  event.setHeaders({ 'cache-control': 'no-store','referrer-policy': FORM_PAGE_REFERRER_POLICY });
  const { supabase,business } = await getOdontoContext(event);
  if (!business.canOperate || !DEPOSIT_ROLES.has(business.role)) return fail(403,{ message: 'No tenés permiso para registrar dinero en este consultorio.' });
  let form: FormData;
  try { form = await readBoundedBookingForm(event.request,[]); }
  catch { return fail(400,{ message: 'No pudimos leer el registro. Actualizá el detalle antes de continuar.' }); }
  const feedback = await submitLateDepositAction(supabase,{ businessId: business.business.id,appointmentId: event.params.appointmentId },form);
  return feedback.success ? feedback : fail(feedback.retry ? 503 : feedback.invalid ? 400 : 409,feedback);
 },
 // AC08: a link is a capability that can be forwarded. Invalidating it changes nothing about the
 // appointment; future messages carry a new one.
 revoke_links: async event => {
  if (!event.locals.auth) throw redirect(303, '/login');
  if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
  if (!isUuid(event.params.appointmentId)) return fail(404, { message: 'No encontramos ese turno.' });
  const form = await readBoundedBookingForm(event.request, []);
  const revision = form.get('expected_revision');
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) return fail(400, { message: 'Actualizá el turno y volvé a intentar.' });
  const { supabase, business } = await getOdontoContext(event);
  if (!business.canOperate || !DEPOSIT_ROLES.has(business.role)) return fail(403, { message: 'Ya no tenés permiso para esta acción. Revisá tu acceso.' });
  const { error } = await supabase.rpc('revoke_appointment_management_access', {
   p_business_id: business.business.id, p_appointment_id: event.params.appointmentId, p_operation_id: crypto.randomUUID(), p_expected_revision: revision
  });
  if (error) {
   if (/\bAPPOINTMENT_MANAGEMENT_CHANGED\b/.test(error.message)) return fail(409, { message: 'El turno cambió. Actualizá la página y revisalo antes de repetir.' });
   logServerFailure('Error invalidando los enlaces del turno', error);
   return fail(503, { message: 'No pudimos confirmar el cambio. Actualizá la página antes de repetirlo.' });
  }
  return { success: true, message: 'Los enlaces enviados ya no permiten gestionar este turno. El turno no cambió.' };
 },
 email_delivery: async event => {
  if (!event.locals.auth) throw redirect(303, '/login');
  if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
  const form = await readBoundedBookingForm(event.request, []);
  const id = form.get('delivery_id'), decision = form.get('decision');
  if (typeof id !== 'string' || !isUuid(id) || (decision !== 'resend' && decision !== 'dismiss'))
   return fail(400, { message: 'Actualizá el turno y volvé a elegir qué hacer con ese correo.' });
  const { supabase, business } = await getOdontoContext(event);
  if (!business.canOperate || !DEPOSIT_ROLES.has(business.role)) return fail(403, { message: 'Ya no tenés permiso para esta acción. Revisá tu acceso.' });
  try {
   await resolveAppointmentEmailDelivery(supabase, business.business.id, id, decision);
   return { success: true, message: decision === 'resend' ? 'El correo vuelve a salir en unos minutos.' : 'El correo quedó descartado.' };
  } catch (cause) {
   const raw = cause instanceof Error ? cause.message : typeof cause === 'object' && cause !== null && 'message' in cause ? String(cause.message) : '';
   if (/\bEMAIL_DELIVERY_CHANGED\b/.test(raw)) return fail(409, { message: 'Ese correo ya cambió de estado. Actualizá la página para verlo.' });
   logServerFailure('Error resolviendo un correo en comprobación', cause);
   return fail(503, { message: 'No pudimos confirmar el cambio. Actualizá la página antes de repetirlo.' });
  }
 },
 prepare_delivery: async event => {
  if (!event.locals.auth) throw redirect(303, '/login');
  if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
  if (!isUuid(event.params.appointmentId)) return fail(404, { message: 'No encontramos ese turno.' });
  event.setHeaders({ 'cache-control': 'no-store', 'referrer-policy': FORM_PAGE_REFERRER_POLICY });
  let form: FormData;
  try { form = await readBoundedBookingForm(event.request, []); }
  catch { return fail(400, { message: 'No pudimos leer esta acción. Actualizá el turno antes de seguir.' }); }
  const kind = form.get('kind'), destination = form.get('destination'), revision = form.get('expected_revision');
  if ((kind !== 'activation' && kind !== 'rescheduled') || (destination !== 'whatsapp' && destination !== 'preview') ||
   typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))
   return fail(400, { message: 'Actualizá el turno y volvé a preparar el enlace desde su botón.' });
  const { supabase, business } = await getOdontoContext(event);
  if (!business.canOperate) return fail(403, { message: 'Ya no tenés permiso para preparar este enlace. Revisá tu acceso.' });
  let delivery;
  try { delivery = await prepareStaffDelivery(supabase, { businessId: business.business.id,
   appointmentId: event.params.appointmentId, expectedRevision: revision, kind }); }
  catch (error) {
   const failure = staffDeliveryFailure(error);
   if (failure.status === 503) logServerFailure('Error preparando el enlace del turno', error);
   return fail(failure.status, { message: failure.message });
  }
  if (destination === 'preview') throw redirect(303, delivery.publicUrl);
  const device = form.get('device');
  const selected = device === 'desktop' || device === 'android' || device === 'ios' || device === 'unknown'
   ? device : classifyUserAgent(event.request.headers.get('user-agent'));
  const location = whatsappHrefFor(selected, delivery.whatsappUrl, delivery.whatsappWebUrl);
  if (!location) return fail(409, { message: 'Falta un teléfono válido. Revisá la ficha del paciente antes de preparar otro mensaje.' });
  throw redirect(303, location);
 },
 save_instructions:async event=>{
  if(!event.locals.auth)throw redirect(303,'/login');if(env.DEMO_MODE==='true')return fail(400,{message:'No disponible en modo demo.'});
  const {supabase,business}=await getOdontoContext(event);const form=await readBoundedBookingForm(event.request);
  const {error}=await supabase.rpc('save_appointment_patient_instructions',{p_business_id:business.business.id,p_appointment_id:event.params.appointmentId,p_expected_updated_at:String(form.get('updated_at')??''),p_instructions:String(form.get('instructions')??''),p_public_description:String(form.get('public_description')??'')});
  if(error)return fail(409,{message:error.message.includes('CARE_CONFIGURATION_CHANGED')?'El turno cambió. Recargá la página antes de guardar las indicaciones.':'No pudimos guardar las indicaciones. Revisá tu permiso y la extensión de los textos.'});return {success:true,message:'Las indicaciones de este turno quedaron guardadas.'};
 },
	// «Confirmar seña», «Exceptuar» and «Deshacer» (plan, sections 4.2 and 4.5): one database transaction.
	deposit: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		if (!isUuid(params.appointmentId)) return fail(404, { message: 'No encontramos ese turno.' });
		const form = await request.formData();
		const action = String(form.get('deposit_action') ?? '').trim();
		if (!(DEPOSIT_ACTIONS as readonly string[]).includes(action)) {
			return fail(400, { message: getDepositErrorMessage('DEPOSIT_ACTION_INVALID') });
		}
		// Digits only: Number('') is 0, and a missing revision must never pass as a stale one.
		const rawRevision = String(form.get('expected_revision') ?? '').trim();
		const expectedRevision = /^\d{1,15}$/.test(rawRevision) ? Number(rawRevision) : Number.NaN;
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
			return fail(400, { message: 'No pudimos leer la versión de la seña. Recargá la página antes de seguir.' });
		}
		const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
		try {
			const change = await setAppointmentDeposit(supabase, {
				businessId: business.business.id,
				appointmentId: params.appointmentId,
				action: action as DepositAction,
				expectedRevision
			});
			const hadAppliedCredit = action === 'pending' && form.get('had_applied_credit') === 'true';
			return {
				success: true,
				message: hadAppliedCredit
					? change.appointmentStatus === 'reserved'
						? 'Se deshizo el registro de la seña. El turno volvió a Reservado y la seña a cuenta volvió a la ficha del paciente.'
						: 'Se deshizo el registro de la seña. La seña volvió a pendiente y el crédito volvió a la ficha del paciente.'
					: DEPOSIT_SUCCESS[action as DepositAction](change.appointmentStatus)
			};
		} catch (depositError) {
			const code = depositError instanceof DepositError ? depositError.code : 'DEPOSIT_UNEXPECTED';
			if (code === 'DEPOSIT_UNEXPECTED') logServerFailure('Error registrando la seña del turno', depositError);
			return fail(getDepositErrorStatus(code), { message: getDepositErrorMessage(code) });
		}
	},
	clear_payment_notice: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		if (!isUuid(params.appointmentId)) return fail(404, { message: 'No encontramos ese turno.' });
		const form = await request.formData();
		const rawRevision = String(form.get('expected_revision') ?? '').trim();
		const expectedRevision = /^\d{1,15}$/.test(rawRevision) ? Number(rawRevision) : Number.NaN;
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
			return fail(400, { message: 'No pudimos leer la versión de la seña. Recargá la página antes de seguir.' });
		}
		const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
		try {
			await clearAppointmentDepositPaymentNotice(supabase, {
				businessId: business.business.id,
				appointmentId: params.appointmentId,
				expectedRevision
			});
			return { success: true, message: 'Se quitó el aviso de pago. El turno volvió al circuito normal.' };
		} catch (depositError) {
			const code = depositError instanceof DepositError ? depositError.code : 'DEPOSIT_UNEXPECTED';
			if (code === 'DEPOSIT_UNEXPECTED') logServerFailure('Error quitando aviso de pago del turno', depositError);
			return fail(getDepositErrorStatus(code), { message: getDepositErrorMessage(code) });
		}
	},
	apply_credit: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		if (!isUuid(params.appointmentId)) return fail(404, { message: 'No encontramos ese turno.' });
		const form = await request.formData();
		const rawRevision = String(form.get('expected_revision') ?? '').trim();
		const expectedRevision = /^\d{1,15}$/.test(rawRevision) ? Number(rawRevision) : Number.NaN;
		const rawCreditId = String(form.get('credit_id') ?? '').trim();
		const creditId = rawCreditId || null;
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
			return fail(400, { message: 'No pudimos leer la versión de la seña. Recargá la página antes de seguir.' });
		}
		if (creditId && !isUuid(creditId)) {
			return fail(400, { message: getDepositErrorMessage('DEPOSIT_CREDIT_UNAVAILABLE') });
		}
		const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
		try {
			const applied = await applyPatientDepositCredit(supabase, {
				businessId: business.business.id,
				appointmentId: params.appointmentId,
				expectedRevision,
				creditId
			});
			return {
				success: true,
				message: applied.differenceNote
					? `Seña a cuenta aplicada. El turno quedó Confirmado. ${applied.differenceNote}`
					: 'Seña a cuenta aplicada. El turno quedó Confirmado.'
			};
		} catch (depositError) {
			const code = depositError instanceof DepositError ? depositError.code : 'DEPOSIT_UNEXPECTED';
			if (code === 'DEPOSIT_UNEXPECTED') logServerFailure('Error aplicando seña a cuenta en el turno', depositError);
			return fail(getDepositErrorStatus(code), { message: getDepositErrorMessage(code) });
		}
	},
 update_status: async event => {
  if (!event.locals.auth) throw redirect(303, '/login');
  if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
  const { supabase, business, userId } = await getOdontoContext(event);
  if (!business.canOperate) return fail(403, { message: 'No tenés permiso para modificar este turno.' });
  const form = await readBoundedBookingForm(event.request, []);
  const admin = await createSupabaseAdminClient('odonto', event.fetch);
  const feedback = await submitStaffManagementAction(supabase, { writer: admin, business: business.business,
   userId, appointmentId: event.params.appointmentId }, 'update_status', form);
  if (!feedback.success) return fail(feedback.retry ? 503 : 409, feedback);
  if (feedback.result?.changed && !feedback.result.idempotentReplay && feedback.result.status === 'cancelled') {
   try { await processAppointmentGoogleCalendarSync(admin, event.params.appointmentId, event.fetch); }
   catch (error) { logServerFailure('Error sincronizando Google Calendar tras cancelar turno', error); }
  }
  return feedback;
 },
 reschedule: async event => {
  if (!event.locals.auth) throw redirect(303, '/login');
  if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
  const { supabase, business, userId } = await getOdontoContext(event);
  if (!business.canOperate) return fail(403, { message: 'No tenés permiso para reprogramar este turno.' });
  const form = await readBoundedBookingForm(event.request, []);
  const admin = await createSupabaseAdminClient('odonto', event.fetch);
  const feedback = await submitStaffManagementAction(supabase, { writer: admin, business: business.business,
   userId, appointmentId: event.params.appointmentId }, 'reschedule', form);
  if (!feedback.success) return fail(feedback.retry ? 503 : 409, feedback);
  if (!feedback.result?.changed || feedback.result.idempotentReplay) return feedback;
  // Agenda, audit, reminder reset and recovery queues committed together in SQL.
  // External attempts happen afterwards; an exact replay adds no immediate notice.
  try { await sendReschedulePushNotice(admin, event.fetch, { businessId: business.business.id, appointmentId: event.params.appointmentId }); }
  catch (error) { logServerFailure('Error enviando aviso de reprogramación', error); }
  try { await processAppointmentGoogleCalendarSync(admin, event.params.appointmentId, event.fetch); }
  catch (error) { logServerFailure('Error sincronizando Google Calendar tras reprogramar', error); }
  const date = localDateFor(feedback.result.startsAt, business.business.timezone);
  throw redirect(303, `/odonto/turnos/${event.params.appointmentId}?from_date=${date}&reprogram_date=${date}&rescheduled=1`);
 }
};

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IntegratedBookingInput } from './booking-integrations';
import { writeAuditLog } from './audit';
import { normalizePhoneE164, normalizePhoneRaw } from './phone';
import {
	getPatientUniqueConflictField,
	isLegacyPatientNameConflict,
	LEGACY_PATIENT_NAME_CONFLICT_MESSAGE,
	PATIENT_UNIQUE_CONFLICT_MESSAGES
} from './patient-identity';
import {
	classifyCommunicationPhone,
	type CommunicationPhoneStatus
} from '$lib/utils/communication-phone';

export const APPOINTMENT_STATUSES = [
	'reserved',
	'confirmed',
	'cancelled',
	'reschedule_requested'
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_SOURCES = ['public_booking', 'manual', 'whatsapp_bot', 'admin'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
	reserved: 'Reservado',
	confirmed: 'Confirmado',
	cancelled: 'Cancelado',
	reschedule_requested: 'Quiere reprogramar'
};

export const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
	public_booking: 'Reserva pública',
	manual: 'Manual',
	whatsapp_bot: 'WhatsApp',
	admin: 'Admin'
};

export const isAppointmentStatus = (value: string): value is AppointmentStatus =>
	(APPOINTMENT_STATUSES as readonly string[]).includes(value);

export const addMinutes = (date: Date, minutes: number) =>
	new Date(date.getTime() + minutes * 60_000);

const transitionMap: Record<AppointmentStatus, AppointmentStatus[]> = {
	reserved: ['confirmed', 'cancelled', 'reschedule_requested'],
	confirmed: ['cancelled', 'reschedule_requested'],
	reschedule_requested: ['cancelled'],
	cancelled: []
};

export const isTerminalAppointmentStatus = (status: AppointmentStatus) =>
	status === 'cancelled';

const resolvePhoneDecision = (input: {
	patientId?: string | null;
	patientPhone?: string | null;
	source?: AppointmentSource;
	phoneCommunicationStatus?: CommunicationPhoneStatus;
	phoneWarningAcknowledged?: boolean;
}) => {
	const classifiedPhone = classifyCommunicationPhone(input.patientPhone);
	let status: CommunicationPhoneStatus | 'unknown';
	if (input.phoneCommunicationStatus) {
		status = input.phoneCommunicationStatus;
		if (status !== classifiedPhone.status) {
			throw new Error('PHONE_COMMUNICATION_STATUS_MISMATCH');
		}
	} else if ((input.source ?? 'manual') !== 'manual') {
		// Los flujos externos anteriores a esta decisión no tienen una instancia
		// de confirmación manual. Sólo afirmamos "valid" si pasan la regla estricta;
		// el resto queda neutral y los canales vuelven a validar antes de enviar.
		status = classifiedPhone.status === 'valid' ? 'valid' : 'unknown';
	} else if (!String(input.patientPhone ?? '').trim() && input.patientId) {
		// Compatibilidad para invocaciones internas legadas que sólo aportan la ficha.
		status = 'unknown';
	} else {
		status = classifiedPhone.status;
	}
	const acknowledged = input.phoneWarningAcknowledged === true;
	if ((status === 'missing' || status === 'invalid') && !acknowledged) {
		throw new Error('PHONE_WARNING_ACKNOWLEDGEMENT_REQUIRED');
	}
	if ((status === 'valid' || status === 'unknown') && acknowledged) {
		throw new Error('PHONE_WARNING_ACKNOWLEDGEMENT_UNEXPECTED');
	}
	return {
		status,
		acknowledged,
		normalized: status === 'valid' ? classifiedPhone.normalized : null
	};
};

export const assertCanTransitionAppointment = (input: {
	currentStatus: AppointmentStatus;
	nextStatus: AppointmentStatus;
	startsAt: Date;
	endsAt: Date;
	now?: Date;
}) => {
	if (input.currentStatus === input.nextStatus) {
		throw new Error('APPOINTMENT_STATUS_UNCHANGED');
	}

	if (isTerminalAppointmentStatus(input.currentStatus)) {
		throw new Error('APPOINTMENT_TERMINAL_STATUS');
	}

	if (!transitionMap[input.currentStatus].includes(input.nextStatus)) {
		throw new Error('APPOINTMENT_INVALID_TRANSITION');
	}
};

export const getHumanAppointmentErrorMessage = (error: unknown) => {
	const anyError = error as { code?: string; message?: string; details?: string };
	const raw = `${anyError?.message ?? ''} ${anyError?.details ?? ''}`;

	if(raw.includes('SCHEDULE_SERVICE_UNAVAILABLE'))return 'Esta franja está reservada para otras prestaciones. Elegí una prestación permitida u otro horario.';
 if(raw.includes('SCHEDULE_BLOCKED'))return 'El consultorio bloqueó ese horario. Actualizá la agenda y elegí otro disponible.';
 if(raw.includes('PRICE_'))return 'El arancel necesita una revisión. Actualizá la página y revisá la fecha y el precio antes de confirmar.';
	if (raw.includes('appointment_professionals_no_break_overlap')) {
		return 'Ese horario invade el descanso configurado de al menos uno de los profesionales. Elegí la primera hora disponible que muestra la agenda. Si estás cargando el turno manualmente y confirmaste que nadie estará atendiendo a otro paciente al mismo tiempo, activá “Ignorar descanso” y volvé a elegir el horario.';
	}
	if (anyError?.code === '23P01' || raw.includes('appointments_no_overlapping_active')) {
		return 'Ese horario dejó de estar disponible porque al menos uno de los profesionales ya tiene otro turno que se superpone. No se reservó a ningún integrante del equipo. Volvé a la agenda, actualizá los horarios y elegí otra opción disponible.';
	}
	const patientConflictField = getPatientUniqueConflictField(anyError);
	if (patientConflictField) return PATIENT_UNIQUE_CONFLICT_MESSAGES[patientConflictField];
	if (isLegacyPatientNameConflict(anyError)) return LEGACY_PATIENT_NAME_CONFLICT_MESSAGE;
	if (raw.includes('APPOINTMENT_NOT_FOUND')) {
		return 'No encontramos ese turno. Volvé a la agenda y abrilo otra vez; es posible que haya sido eliminado o que ya no tengas acceso.';
	}
	if (raw.includes('PATIENT_NAME_REQUIRED')) {
		return 'Falta el nombre del paciente. Escribilo antes de intentar crear el turno.';
	}
	if (raw.includes('PATIENT_OWNER_REQUIRED')) {
		return 'No pudimos identificar al responsable del consultorio para crear la ficha del paciente. Pedile a un administrador que revise la configuración del equipo y volvé a intentar.';
	}
	if (raw.includes('PATIENT_OWNER_INVALID') || raw.includes('APPOINTMENT_CREATOR_INVALID')) {
		return 'Tu acceso al consultorio cambió mientras preparabas el turno. Recargá la agenda para actualizar tus permisos y volvé a intentarlo; si seguís sin poder crear el turno, pedile ayuda a un administrador.';
	}
	if (raw.includes('PATIENT_NOT_FOUND')) {
		return 'No encontramos al paciente seleccionado. Buscalo otra vez en la lista o creá una ficha nueva antes de reservar.';
	}
	if (raw.includes('PATIENT_ARCHIVED')) {
		return 'La ficha seleccionada está archivada y no puede recibir un turno nuevo. Restaurala desde Pacientes o elegí otra ficha activa.';
	}
	if (raw.includes('PATIENT_BLOCKED')) {
		return 'Ese paciente está bloqueado y no puede recibir nuevos turnos. Revisá su ficha y quitá el bloqueo sólo si corresponde.';
	}
	if (raw.includes('SERVICE_NOT_FOUND')) {
		return 'El procedimiento seleccionado ya no está disponible. Volvé al primer paso y elegí un procedimiento activo.';
	}
	if (
		raw.includes('PATIENT_MODE_INVALID') ||
		raw.includes('PATIENT_ID_REQUIRED') ||
		raw.includes('PATIENT_ID_UNEXPECTED') ||
		raw.includes('PATIENT_EXISTING_FIELDS_UNEXPECTED') ||
		raw.includes('PATIENT_MODE_SOURCE_MISMATCH') ||
		raw.includes('PATIENT_PHONE_UPDATE_MODE_INVALID')
	) {
		return 'La selección del paciente quedó inconsistente. Volvé al último paso, elegí de nuevo “Buscar paciente” o “Nuevo paciente” y confirmá el turno.';
	}
	if (raw.includes('APPOINTMENT_IDEMPOTENCY_CONFLICT')) {
		return 'La solicitud ya se usó para otro turno y, por seguridad, no repetimos la operación. Cerrá el asistente, abrilo nuevamente y volvé a confirmar.';
	}
	if (raw.includes('APPOINTMENT_IDEMPOTENCY_KEY_INVALID')) {
		return 'La sesión para crear el turno venció o quedó incompleta. Cerrá el asistente, abrilo nuevamente y volvé a confirmar.';
	}
	if (raw.includes('PROFESSIONAL_NOT_FOUND')) {
		return 'Uno de los profesionales seleccionados ya no está activo. Volvé a elegir el equipo antes de reservar.';
	}
	if (
		raw.includes('PROFESSIONAL_SERVICE_NOT_ASSIGNED') ||
		raw.includes('TEAM_PROFESSIONAL_SERVICE_NOT_ASSIGNED')
	) {
		return 'Al menos uno de los profesionales seleccionados no está habilitado para este procedimiento. Volvé al paso del equipo, quitá a ese profesional o asignale el procedimiento desde su configuración.';
	}
	if (raw.includes('JOINT_APPOINTMENT_REQUIRES_TWO_PROFESSIONALS')) {
		return 'Un turno conjunto necesita por lo menos dos profesionales diferentes. Seleccioná dos o más integrantes del equipo y volvé a buscar horarios.';
	}
	if (
		raw.includes('JOINT_APPOINTMENT_DUPLICATE_PROFESSIONAL') ||
		raw.includes('JOINT_APPOINTMENT_INVALID_PROFESSIONAL')
	) {
		return 'La selección del equipo contiene un profesional repetido o inválido. Volvé al paso del equipo, revisá los integrantes marcados y continuá nuevamente.';
	}
	if (
		raw.includes('TEAM_MUST_BE_RECALCULATED') ||
		raw.includes('TEAM_PROFESSIONAL_NOT_AVAILABLE')
	) {
		return 'El equipo cambió desde que se abrió este turno y su disponibilidad debe calcularse de nuevo. Volvé a la agenda, revisá que todos sigan activos y asignados al procedimiento, y elegí un horario nuevo.';
	}
	if (raw.includes('APPOINTMENT_TERMINAL_STATUS')) {
		return 'Ese turno ya está cancelado y no se puede volver a modificar.';
	}
	if (raw.includes('APPOINTMENT_INVALID_TRANSITION')) {
		return 'Ese cambio de estado no corresponde al estado actual del turno. Recargá la página y elegí una de las acciones disponibles.';
	}
	if (raw.includes('APPOINTMENT_STATUS_UNCHANGED')) {
		return 'El turno ya tiene ese estado. No hace falta guardar ningún cambio.';
	}
	if (raw.includes('APPOINTMENT_STATUS_CONFLICT')) {
		return 'El turno cambió mientras lo estabas actualizando y no sobrescribimos ese cambio. Recargá la agenda para ver el estado actual.';
	}
	if (raw.includes('APPOINTMENT_CANNOT_RESCHEDULE')) {
		return 'Este turno ya está cerrado y no puede reprogramarse. Si necesitás una nueva atención, creá un turno nuevo desde la agenda.';
	}
	if (raw.includes('APPOINTMENT_ACCESS_DENIED')) {
		return 'Tu usuario no forma parte del equipo asignado a este turno y no tiene permiso para modificarlo. Pedile ayuda a recepción o a un administrador.';
	}
	if (raw.includes('BUSINESS_ACCESS_RESTRICTED')) {
		return 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.';
	}
	return 'No pudimos completar la acción y no se guardó ningún cambio. Recargá la página y volvé a intentar; si vuelve a ocurrir, pedile a un administrador que revise el registro interno del error.';
};

export type AppointmentPatientSelection =
	| {
			mode: 'existing';
			patientId: string;
		phone?: string | null;
			updatePhone?: boolean;
	}
	| {
			mode: 'new';
			name: string;
			phone?: string | null;
			email?: string | null;
	}
	| {
			mode: 'public';
			name: string;
			phone: string;
			email?: string | null;
		};

export type BookingPatientInformationInput = { schemaHash: string; answers: import('@turnos-saas/shared/booking-integration').BookingIntakeAnswers; priceQuoteHash?: string };

export type AtomicAppointmentInput = {
	businessId: string;
	ownerId?: string | null;
	createdByUserId?: string | null;
	patient: AppointmentPatientSelection;
	serviceId: string;
	professionalIds: string[];
	startsAt: Date;
	internalNote?: string | null;
	source?: AppointmentSource;
	ignoreBreak?: boolean;
	phoneCommunicationStatus?: CommunicationPhoneStatus;
	phoneWarningAcknowledged?: boolean;
	idempotencyKey: string;
	bookingIntegration?: IntegratedBookingInput;
	bookingInformation?: BookingPatientInformationInput;
};

const APPOINTMENT_IDEMPOTENCY_KEY_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AtomicAppointmentResult = {
	id: string;
	patient_id?: string;
	confirmation_token?: string;
	starts_at?: string;
	ends_at?: string;
	service_name_snapshot?: string;
	professional_name_snapshot?: string;
	patient_created?: boolean;
	idempotent_replay?: boolean;
	patient_resolution_strategy?: string;
};

const runAtomicAppointmentRpc = async (
	supabase: SupabaseClient,
	input: AtomicAppointmentInput,
	replayOnly: boolean
): Promise<AtomicAppointmentResult | null> => {
	const professionalIds = input.professionalIds.map((id) => id.trim()).filter(Boolean);
	if (professionalIds.length === 0) throw new Error('PROFESSIONAL_NOT_FOUND');
	if (new Set(professionalIds).size !== professionalIds.length) {
		throw new Error('JOINT_APPOINTMENT_DUPLICATE_PROFESSIONAL');
	}
	if (!APPOINTMENT_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
		throw new Error('APPOINTMENT_IDEMPOTENCY_KEY_INVALID');
	}

	const patientPhone = input.patient.phone ?? null;
	const source = input.source ?? 'manual';
	if ((input.patient.mode === 'public') !== (source === 'public_booking')) {
		throw new Error('PATIENT_MODE_SOURCE_MISMATCH');
	}
	const phoneDecision = resolvePhoneDecision({
		patientId: input.patient.mode === 'existing' ? input.patient.patientId : null,
		patientPhone,
		source,
		phoneCommunicationStatus: input.phoneCommunicationStatus,
		phoneWarningAcknowledged: input.phoneWarningAcknowledged
	});
	const patientPhoneE164 =
		phoneDecision.status === 'valid'
			? phoneDecision.normalized
			: phoneDecision.status === 'unknown'
				? normalizePhoneE164(patientPhone)
				: null;

	if ((input.bookingIntegration || input.bookingInformation) && (input.patient.mode !== 'public' || source !== 'public_booking' || input.ignoreBreak || input.ownerId || input.createdByUserId)) {
		throw new Error('PATIENT_MODE_SOURCE_MISMATCH');
	}
	const rpc = input.bookingInformation
        ? supabase.rpc('create_public_booking_with_information', {
            p_input: {
                business_id: input.businessId, patient_name: input.patient.mode === 'public' ? input.patient.name.trim() : null,
                patient_phone_raw: normalizePhoneRaw(patientPhone), patient_phone_e164: patientPhoneE164,
                patient_email: input.patient.mode === 'public' ? String(input.patient.email ?? '').trim() || null : null,
                service_id: input.serviceId, professional_ids: professionalIds, starts_at: input.startsAt.toISOString(),
                comment: input.internalNote?.trim() || null, phone_status: phoneDecision.status,
                request_key: input.idempotencyKey.toLowerCase(), schema_hash: input.bookingInformation.schemaHash,
                answers: input.bookingInformation.answers, price_quote_hash: input.bookingInformation.priceQuoteHash ?? '', integration_id: input.bookingIntegration?.integrationId ?? null,
                integration_revision: input.bookingIntegration?.integrationRevision ?? null,
                availability_revision: input.bookingIntegration?.expectedAvailabilityRevision ?? null,
                entry_point: input.bookingIntegration?.entryPoint ?? 'public_page', modality: input.bookingIntegration?.modality ?? 'in_person'
            }, p_replay_only: replayOnly
        })
        : input.bookingIntegration
		? supabase.rpc('create_integrated_public_appointment', {
			p_integration_id: input.bookingIntegration.integrationId,
			p_integration_revision: input.bookingIntegration.integrationRevision,
			p_expected_availability_revision: input.bookingIntegration.expectedAvailabilityRevision ?? null,
			p_patient_name: input.patient.mode === 'public' ? input.patient.name.trim() : null,
			p_patient_phone_raw: normalizePhoneRaw(patientPhone),
			p_patient_phone_e164: patientPhoneE164,
			p_patient_email: input.patient.mode === 'public' ? String(input.patient.email ?? '').trim() || null : null,
			p_service_id: input.serviceId,
			p_professional_ids: professionalIds,
			p_starts_at: input.startsAt.toISOString(),
			p_internal_note: input.internalNote?.trim() || null,
			p_phone_communication_status: phoneDecision.status,
			p_modality: input.bookingIntegration.modality,
			p_intake_answers: input.bookingIntegration.intakeAnswers,
			p_idempotency_key: input.idempotencyKey.toLowerCase(),
			p_replay_only: replayOnly,
			p_entry_point: input.bookingIntegration.entryPoint ?? 'embedded'
		})
		: supabase.rpc('create_appointment_with_patient_identity', {
			p_business_id: input.businessId,
			p_patient_mode: input.patient.mode,
			p_patient_id: input.patient.mode === 'existing' ? input.patient.patientId : null,
			p_patient_name: input.patient.mode === 'existing' ? null : input.patient.name.trim(),
			p_patient_phone_raw: normalizePhoneRaw(patientPhone),
			p_patient_phone_e164: patientPhoneE164,
			p_patient_email:
				input.patient.mode === 'existing' ? null : String(input.patient.email ?? '').trim() || null,
			p_update_existing_phone:
				input.patient.mode === 'existing' && input.patient.updatePhone === true,
			p_owner_id: input.ownerId ?? null,
			p_service_id: input.serviceId,
			p_professional_ids: professionalIds,
			p_starts_at: input.startsAt.toISOString(),
			p_internal_note: input.internalNote?.trim() || null,
			p_created_by_user_id: input.createdByUserId ?? null,
			p_ignore_break: Boolean(input.ignoreBreak),
			p_source: source,
			p_phone_communication_status: phoneDecision.status,
			p_phone_warning_acknowledged: phoneDecision.acknowledged,
			p_idempotency_key: input.idempotencyKey.toLowerCase(),
			p_replay_only: replayOnly
		});
	const { data, error } = replayOnly ? await rpc.maybeSingle() : await rpc.single();
	if (error) throw error;
	const appointment = data as AtomicAppointmentResult | null;
	if (!appointment?.id) {
		if (replayOnly) return null;
		throw new Error('APPOINTMENT_NOT_CREATED');
	}
	return { ...appointment, id: appointment.id };
};

// Read-only idempotency probe used before mutable policy and availability
// checks. A null result means the caller must continue with normal creation.
export const findAppointmentCreationReplay = async (
	supabase: SupabaseClient,
	input: AtomicAppointmentInput
) => runAtomicAppointmentRpc(supabase, input, true);

export const createManualAppointment = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		ownerId?: string | null;
		createdByUserId?: string | null;
		patient: AppointmentPatientSelection;
		serviceId: string;
		professionalId: string;
		startsAt: Date;
		internalNote?: string | null;
		source?: AppointmentSource;
		ignoreBreak?: boolean;
		phoneCommunicationStatus?: CommunicationPhoneStatus;
		phoneWarningAcknowledged?: boolean;
		idempotencyKey: string;
		bookingIntegration?: IntegratedBookingInput;
	bookingInformation?: BookingPatientInformationInput;
	}
) => {
	const created = await runAtomicAppointmentRpc(supabase, {
		...input,
		professionalIds: [input.professionalId]
	}, false);
	if (!created) throw new Error('APPOINTMENT_NOT_CREATED');
	return created;
};

export const createJointAppointment = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		ownerId?: string | null;
		createdByUserId?: string | null;
		patient: AppointmentPatientSelection;
		serviceId: string;
		professionalIds: string[];
		startsAt: Date;
		internalNote?: string | null;
		ignoreBreak?: boolean;
		source?: AppointmentSource;
		phoneCommunicationStatus?: CommunicationPhoneStatus;
		phoneWarningAcknowledged?: boolean;
		idempotencyKey: string;
		bookingIntegration?: IntegratedBookingInput;
	bookingInformation?: BookingPatientInformationInput;
	}
) => {
	const professionalIds = input.professionalIds
		.map((professionalId) => professionalId.trim())
		.filter(Boolean);
	if (professionalIds.length < 2) {
		throw new Error('JOINT_APPOINTMENT_REQUIRES_TWO_PROFESSIONALS');
	}
	const created = await runAtomicAppointmentRpc(supabase, { ...input, professionalIds }, false);
	if (!created) throw new Error('APPOINTMENT_NOT_CREATED');
	return created;
};

export const updateAppointmentStatus = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		appointmentId: string;
		status: AppointmentStatus;
		userId: string;
		reason?: string | null;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();

	const { data: appointment, error: loadError } = await supabase
		.from('appointments')
		.select('id, starts_at, ends_at, status')
		.eq('business_id', input.businessId)
		.eq('id', input.appointmentId)
		.maybeSingle();
	if (loadError) throw loadError;
	if (!appointment) throw new Error('APPOINTMENT_NOT_FOUND');

	assertCanTransitionAppointment({
		currentStatus: appointment.status as AppointmentStatus,
		nextStatus: input.status,
		startsAt: new Date(appointment.starts_at),
		endsAt: new Date(appointment.ends_at),
		now
	});

	const updates: Record<string, unknown> = {
		status: input.status,
		updated_by_user_id: input.userId,
		updated_at: now.toISOString()
	};

	if (input.status === 'confirmed') updates.confirmed_at = now.toISOString();
	if (input.status === 'cancelled') {
		updates.cancelled_at = now.toISOString();
		updates.cancelled_by_user_id = input.userId;
		updates.cancelled_reason = input.reason || null;
	}
	if (input.status === 'reschedule_requested') updates.reschedule_requested_at = now.toISOString();

	const { data: changedAppointment, error } = await supabase
		.from('appointments')
		.update(updates)
		.eq('business_id', input.businessId)
		.eq('id', input.appointmentId)
		// Serialize competing transitions at the state observed above. Without
		// this predicate, two professionals can both pass the local transition
		// check and the last request can overwrite the first one.
		.eq('status', appointment.status)
		.select('id')
		.maybeSingle();
	if (error) throw error;
	if (!changedAppointment) throw new Error('APPOINTMENT_STATUS_CONFLICT');

	await writeAuditLog(supabase, {
		businessId: input.businessId,
		userId: input.userId,
		action: `appointment.${input.status}`,
		entityType: 'appointment',
		entityId: input.appointmentId,
		metadata: {
			from_status: appointment.status,
			to_status: input.status,
			reason: input.status === 'cancelled' ? (input.reason ?? null) : null
		}
	});
};

export const rescheduleAppointment = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		appointmentId: string;
		userId: string;
		startsAt: Date;
		ignoreBreak?: boolean;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	const { data: appointment, error: loadError } = await supabase
		.from('appointments')
		.select(
			'id, service_id, professional_id, starts_at, ends_at, status, ignore_break, calendar_sequence, calendar_action_count'
		)
		.eq('business_id', input.businessId)
		.eq('id', input.appointmentId)
		.maybeSingle();
	if (loadError) throw loadError;
	if (!appointment) throw new Error('APPOINTMENT_NOT_FOUND');
	if (isTerminalAppointmentStatus(appointment.status as AppointmentStatus)) {
		throw new Error('APPOINTMENT_CANNOT_RESCHEDULE');
	}

	const { data: service, error: serviceError } = await supabase
		.from('services')
		.select('duration_minutes, is_active')
		.eq('business_id', input.businessId)
		.eq('id', appointment.service_id)
		.maybeSingle();
	if (serviceError) throw serviceError;
	if (!service?.duration_minutes || !service.is_active) throw new Error('SERVICE_NOT_FOUND');

	const endsAt = addMinutes(input.startsAt, Number(service.duration_minutes));
	// Versionado del evento de calendario: el ICS del mismo turno sale con SEQUENCE
	// incrementado, y si el paciente ya había registrado una acción de calendario el
	// turno queda "pendiente de actualizar" (banner en /turno + sección Recordatorios).
	const hadCalendarAction = Number((appointment as any).calendar_action_count ?? 0) > 0;
	const { data: changedAppointment, error } = await supabase
		.from('appointments')
		.update({
			starts_at: input.startsAt.toISOString(),
			ends_at: endsAt.toISOString(),
			status: 'reserved',
			confirmed_at: null,
			reschedule_requested_at: null,
			reminder_due_at: null,
			calendar_sequence: Number((appointment as any).calendar_sequence ?? 0) + 1,
			calendar_update_required_at: hadCalendarAction ? now.toISOString() : null,
			// Una reprogramación vuelve a calcular desde cero. La excepción al
			// descanso sólo continúa si el usuario la solicita otra vez.
			ignore_break: Boolean(input.ignoreBreak),
			updated_by_user_id: input.userId,
			updated_at: now.toISOString()
		})
		.eq('business_id', input.businessId)
		.eq('id', input.appointmentId)
		// Do not resurrect a cancellation (or overwrite another transition)
		// that happened after the initial read.
		.eq('status', appointment.status)
		.select('id')
		.maybeSingle();
	if (error) throw error;
	if (!changedAppointment) throw new Error('APPOINTMENT_STATUS_CONFLICT');

	await writeAuditLog(supabase, {
		businessId: input.businessId,
		userId: input.userId,
		action: 'appointment.rescheduled',
		entityType: 'appointment',
		entityId: input.appointmentId,
		metadata: {
			from_starts_at: appointment.starts_at,
			from_ends_at: appointment.ends_at,
			to_starts_at: input.startsAt.toISOString(),
			to_ends_at: endsAt.toISOString(),
			from_status: appointment.status,
			to_status: 'reserved',
			ignore_break: Boolean(input.ignoreBreak),
			calendar_update_required: hadCalendarAction
		}
	});
};

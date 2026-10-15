import { bookingInformationEnabled } from './booking-information';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	BOOKING_INTEGRATION_KEY_PATTERN, BOOKING_MODALITIES, BOOKING_THEMES,
	normalizeBookingOrigin, parseBookingIntakeFields, parsePublicPatientFields, parseBookingModalityWindows, validateBookingIntakeAnswers,
	type BookingIntakeAnswers, type BookingModality, type BookingModalityWindow, type BookingPresentation
} from '@turnos-saas/shared/booking-integration';

export type BookingIntegration = BookingPresentation & {
	id: string;
	businessId: string;
	publicKey: string;
	revision: number;
	isActive: boolean;
	isDefault: boolean;
	allowedOrigins: string[];
	serviceIds: string[];
	professionalIds: string[];
	modalityWindows: BookingModalityWindow[];
};
export type AppointmentBookingContext = {
	theme: BookingPresentation['theme'];
	modality: BookingModality;
	videoInstructions: string | null;
};
export type IntegratedBookingInput = {
	integrationId: string;
	integrationRevision: number;
	expectedAvailabilityRevision?: number;
	modality: BookingModality;
	intakeAnswers: BookingIntakeAnswers;
	entryPoint?: 'embedded' | 'public_page';
	modalityWindows?: BookingModalityWindow[];
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ids = (value: unknown, max: number): string[] => {
	if (!Array.isArray(value) || value.length > max || value.some((id) => typeof id !== 'string' || !UUID.test(id))) {
		throw new Error('BOOKING_INTEGRATION_CONFIGURATION_INVALID');
	}
	return [...new Set(value)];
};

export function parseBookingIntegration(row: Record<string, any>, allowLocal = false): BookingIntegration {
	if (!UUID.test(row.id) || !UUID.test(row.business_id) || !BOOKING_INTEGRATION_KEY_PATTERN.test(row.public_key) ||
		row.contract_version !== 1 || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1 ||
		!BOOKING_THEMES.includes(row.theme) || typeof row.is_active !== 'boolean' ||
		!Array.isArray(row.allowed_origins) || row.allowed_origins.length > 20 ||
		!Array.isArray(row.allowed_modalities) || row.allowed_modalities.length < 1 || row.allowed_modalities.length > 2 ||
		row.allowed_modalities.some((modality: any) => !BOOKING_MODALITIES.includes(modality)) ||
		new Set(row.allowed_modalities).size !== row.allowed_modalities.length) {
		throw new Error('BOOKING_INTEGRATION_CONFIGURATION_INVALID');
	}
	const allowedOrigins = row.allowed_origins.map((origin: unknown) =>
		typeof origin === 'string' ? normalizeBookingOrigin(origin, allowLocal) : null);
	if (allowedOrigins.some((origin: string | null) => !origin) || new Set(allowedOrigins).size !== allowedOrigins.length) {
		throw new Error('BOOKING_INTEGRATION_CONFIGURATION_INVALID');
	}
	const videoInstructions = typeof row.video_instructions === 'string' ? row.video_instructions.trim() : null;
	if (row.allowed_modalities.includes('video') && !videoInstructions) throw new Error('BOOKING_INTEGRATION_CONFIGURATION_INVALID');
	return {
		id: row.id, businessId: row.business_id, publicKey: row.public_key,
		revision: Number(row.revision), isActive: row.is_active, isDefault: row.is_default === true, theme: row.theme,
		allowedOrigins: allowedOrigins as string[], serviceIds: ids(row.allowed_service_ids, 500),
		professionalIds: ids(row.allowed_professional_ids, 100), modalities: row.allowed_modalities,
		intakeFields: parseBookingIntakeFields(row.intake_schema), videoInstructions,
		modalityWindows: parseBookingModalityWindows(row.modality_windows ?? [])
	};
}

const INTEGRATION_SELECT = 'id, business_id, public_key, revision, is_active, is_default, contract_version, theme, allowed_origins, allowed_service_ids, allowed_professional_ids, allowed_modalities, video_instructions, intake_schema, modality_windows';

export async function loadDefaultBookingIntegration(supabase: SupabaseClient, businessId: string, allowLocal = false) {
	const { data, error } = await supabase.from('booking_integrations').select(INTEGRATION_SELECT)
		.eq('business_id', businessId).eq('is_default', true).maybeSingle();
	if (error) throw error;
	return data ? parseBookingIntegration(data, allowLocal) : null;
}

export async function loadBookingIntegration(supabase: SupabaseClient, publicKey: string, allowLocal = false) {
	if (!BOOKING_INTEGRATION_KEY_PATTERN.test(publicKey)) return null;
	const { data, error } = await supabase.from('booking_integrations').select(INTEGRATION_SELECT).eq('public_key', publicKey).maybeSingle();
	if (error) throw error;
	return data ? parseBookingIntegration(data, allowLocal) : null;
}

export function bookingPresentation(integration: BookingIntegration): BookingPresentation {
	return {
		theme: integration.theme, modalities: integration.modalities,
		intakeFields: integration.intakeFields, videoInstructions: null
	};
}

export function assertIntegrationSelection(integration: BookingIntegration, input: { serviceId: string; professionalIds: string[]; modality: unknown }) {
	if (!integration.isActive) throw new Error('BOOKING_INTEGRATION_UNAVAILABLE');
	if (!integration.modalities.includes(input.modality as BookingModality)) throw new Error('BOOKING_MODALITY_UNAVAILABLE');
	if ((integration.serviceIds.length && !integration.serviceIds.includes(input.serviceId)) ||
		(integration.professionalIds.length && input.professionalIds.some((id) => !integration.professionalIds.includes(id)))) {
		throw new Error('BOOKING_INTEGRATION_SCOPE_INVALID');
	}
}

export function intakeAnswersFromForm(integration: Pick<BookingIntegration, 'intakeFields'>, form: FormData) {
	const raw: Record<string, unknown> = Object.create(null);
	for (const field of integration.intakeFields) {
		const values = form.getAll('intake_' + field.id);
		if (values.length > 1 || values.some((value) => typeof value !== 'string')) throw new Error('BOOKING_INTAKE_ANSWERS_INVALID');
		if (!values.length || values[0] === '') continue;
		raw[field.id] = field.kind === 'boolean'
			? values[0] === 'true' ? true : values[0] === 'false' ? false : null
			: values[0];
	}
	for (const key of form.keys()) {
		if (key.startsWith('intake_') && !integration.intakeFields.some((field) => key === 'intake_' + field.id)) throw new Error('BOOKING_INTAKE_ANSWERS_INVALID');
	}
	return validateBookingIntakeAnswers(integration.intakeFields, raw);
}

export async function loadAppointmentBookingContext(supabase: SupabaseClient, appointmentId: string): Promise<AppointmentBookingContext | null> {
	const { data, error } = await supabase.from('appointment_booking_contexts')
		.select('theme_snapshot, modality, video_instructions_snapshot').eq('appointment_id', appointmentId).maybeSingle();
	if (error) throw error;
	if (!data) return null;
	if (!BOOKING_THEMES.includes(data.theme_snapshot) || !BOOKING_MODALITIES.includes(data.modality)) throw new Error('BOOKING_INTEGRATION_CONFIGURATION_INVALID');
	return { theme: data.theme_snapshot, modality: data.modality, videoInstructions: data.video_instructions_snapshot };
}

/** Use the authenticated client: RLS protects clinical answers and archived links. */
export async function loadAppointmentIntakeForPatient(supabase: SupabaseClient, businessId: string, appointmentId: string, patientId: string) {
	const { data, error } = await supabase.from('appointment_intake_responses')
		.select('schema_snapshot, answers, free_comment').eq('business_id', businessId).eq('appointment_id', appointmentId)
		.eq('patient_id', patientId).maybeSingle();
	if (error) throw error;
	let declaration = data;
	if (bookingInformationEnabled()) {
		const latest = await supabase.from('appointment_intake_submissions').select('schema_snapshot,answers,free_comment').eq('business_id', businessId).eq('appointment_id', appointmentId).eq('patient_id', patientId).order('sequence_no', { ascending: false }).limit(1).maybeSingle();
		if (latest.error) throw latest.error;
		declaration = latest.data ?? data;
	}
	if (!declaration) return null;
	const fields = parsePublicPatientFields(declaration.schema_snapshot);
	const answers = validateBookingIntakeAnswers(fields, declaration.answers);
	const responses = fields.map((field) => ({
		label: field.label,
		value: Object.hasOwn(answers, field.id) ? typeof answers[field.id] === 'boolean' ? answers[field.id] ? 'Sí' : 'No' : String(answers[field.id]) : 'Sin responder'
	}));
	if (declaration.free_comment) responses.push({ label: 'Comentario informado por el paciente', value: String(declaration.free_comment) });
	return responses;
}

export const INTEGRATION_ERROR_MESSAGES: Record<string, string> = {
	APPOINTMENT_IDEMPOTENCY_CONFLICT: 'Esta solicitud ya se utilizó con otros datos. Revisá el resultado de la reserva antes de iniciar otra.',
	BOOKING_FORM_INVALID: 'Hay un dato demasiado extenso o inválido. Revisá el formulario antes de confirmar.',
	BOOKING_INTEGRATION_UNAVAILABLE: 'La reserva desde este sitio no está disponible. Contactá al consultorio para pedir tu turno.',
	BOOKING_INTEGRATION_CHANGED: 'Las opciones de reserva cambiaron. Volvé al primer paso y revisá tu selección antes de confirmar.',
	BOOKING_AVAILABILITY_CHANGED: 'El consultorio actualizó sus horarios. Volvé a elegir el día y horario antes de confirmar.',
	BOOKING_MODALITY_UNAVAILABLE: 'Esa modalidad ya no está disponible. Volvé al primer paso y elegí una opción habilitada.',
	BOOKING_INTEGRATION_SCOPE_INVALID: 'La consulta o el profesional elegido no está disponible desde este sitio. Volvé al primer paso y elegí una de las opciones mostradas.',
	BOOKING_INTAKE_REQUIRED: 'Faltan respuestas obligatorias. Revisá los datos de la reserva y completalos antes de confirmar.',
	BOOKING_INTAKE_TOO_LONG: 'Las respuestas son demasiado extensas. Acortá los comentarios antes de confirmar.',
	BOOKING_INTAKE_ANSWERS_INVALID: 'Hay una respuesta incompleta o inválida. Revisá los datos de la reserva antes de confirmar.'
};

export function integratedBookingErrorMessage(error: unknown): string | null {
	const candidate = error as { message?: string };
	const raw = String(candidate?.message ?? '');
	return Object.entries(INTEGRATION_ERROR_MESSAGES).find(([code]) =>
		new RegExp('(^|[^A-Z0-9_])' + code + '([^A-Z0-9_]|$)').test(raw))?.[1] ?? null;
}

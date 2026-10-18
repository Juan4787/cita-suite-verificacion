import { env } from '$env/dynamic/private';
import { error, type RequestEvent } from '@sveltejs/kit';
import type { CitaSupabaseClient } from '$lib/types/database';
import { parsePublicPatientFields, validateBookingIntakeAnswers } from '@cita-suite/shared/booking-integration';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { hashRateLimitSubject } from '$lib/server/platform/rate-limits';
import { readBoolean, readRecord, readText, isRecord } from '$lib/contracts/json';

export const bookingInformationEnabled = () => env.BOOKING_INFORMATION_ENABLED === 'true';
export const privateInformationHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
export type PublicInformation = {
 documents_enabled?:boolean;
  theme: import('@cita-suite/shared/booking-integration').BookingTheme;
  schema: ReturnType<typeof parsePublicPatientFields>;
  schema_hash: string; answers: Record<string, string | boolean>; comment: string; version: string;
};

export async function informationContext(event: RequestEvent) {
  if (!event.locals.bookingInformationHeadersApplied) {
    event.setHeaders(privateInformationHeaders);
    event.locals.bookingInformationHeadersApplied = true;
  }
  if (!bookingInformationEnabled()) error(503, 'La información previa todavía no está habilitada. Podés conservar tu reserva.');
  const token = event.params.token ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) error(404, 'Este enlace no está disponible. Abrí el enlace de tu turno.');
  const admin = await createSupabaseAdminClient('odonto', event.fetch);
  const { data, error: rateError } = await admin.rpc('consume_booking_integration_read_limit', { p_subject_hash: hashRateLimitSubject(event.getClientAddress()) });
  if (rateError) error(503, 'No pudimos abrir la información. Esperá unos segundos y volvé a intentar.');
  if (data !== true) error(429, 'Hubo varios intentos seguidos. Esperá un minuto y volvé a intentar.');
  return { admin, token };
}

export function informationErrorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : isRecord(cause) ? String(cause.message ?? '') : '';
  if (message.includes('BOOKING_INFORMATION_CHANGED')) return 'Las preguntas o las respuestas cambiaron. Recargá la página y revisá tus datos antes de continuar.';
  if (message.includes('BOOKING_INFORMATION_REQUEST_CONFLICT')) return 'Este envío ya se usó con otros datos. Revisá lo que quedó guardado antes de iniciar otro.';
  if (message.includes('BOOKING_PROFILE_DATA_INVALID')) return 'Revisá la edad o fecha de nacimiento ingresada antes de confirmar.';
  if (message.includes('BOOKING_PROFILE_OPTIONS_CONFLICT')) return 'Las preguntas de los profesionales necesitan una revisión del consultorio. Contactalo para pedir tu turno.';
  if (message.includes('BOOKING_INFORMATION_UNAVAILABLE')) return 'Este turno ya no admite información previa. Abrí tu turno o contactá al consultorio.';
  if (message.includes('BOOKING_INTAKE_REQUIRED')) return 'Completá las respuestas obligatorias que pide la profesional antes de confirmar.';
  if (message.includes('BOOKING_INTAKE')) return 'Revisá las respuestas y acortá los textos demasiado extensos antes de guardar.';
  if (message.includes('BOOKING_INFORMATION_LIMIT')) return 'Hubo muchos envíos para este turno. Contactá al consultorio para continuar.';
  return 'No pudimos completar el envío. Tu reserva se conserva. Volvé a intentar en unos minutos.';
}

export async function loadBookingInformation(admin: CitaSupabaseClient, token: string): Promise<PublicInformation> {
  const { data, error: cause } = await admin.rpc('get_public_booking_information', { p_token: token });
  if (cause) throw cause;
  const row = readRecord(data, 'bookingInformation');
  const theme = row.theme;
  if (theme !== 'natalia' && theme !== 'cita-suite') throw new Error('BOOKING_INFORMATION_UNAVAILABLE');
  const schema = parsePublicPatientFields(row.schema);
  return { theme, schema,
    schema_hash: readText(row.schema_hash, 'bookingInformation.schema_hash'),
    answers: validateBookingIntakeAnswers(schema, row.answers),
    comment: readText(row.comment, 'bookingInformation.comment'),
    version: readText(row.version, 'bookingInformation.version'),
    ...(row.documents_enabled === undefined ? {} : { documents_enabled: readBoolean(row.documents_enabled, 'bookingInformation.documents_enabled') })
  };
}


export async function loadProfessionalBookingSchema(admin: CitaSupabaseClient, businessId: string, professionalIds: string[], integrationId?: string, requestKey?: string) {
  const { data, error: cause } = await admin.rpc('get_public_patient_booking_schema', { p_business_id: businessId, p_professional_ids: professionalIds, p_integration_id: integrationId ?? null, p_request_key: requestKey ?? null });
  if (cause) throw cause;
  const row = readRecord(data, 'professionalBookingSchema');
  return { fields: parsePublicPatientFields(row.schema), hash: readText(row.hash, 'professionalBookingSchema.hash') };
}

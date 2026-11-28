import { BOOKING_THEMES, BOOKING_INTEGRATION_KEY_PATTERN, parseBookingModalityWindows, type BookingModality } from '@cita-suite/shared/booking-integration';
import { InvalidDataContractError, readArray, readBoolean, readNullableText, readRecord, readText, readJson } from '$lib/contracts/json';
import { parsePriceQuote } from '$lib/scheduling/price-contracts';
import { parseAppointmentDeposit, parseCancellationDepositOutcome } from '$lib/scheduling/deposits';
import { parseRescheduleFinancialTerms } from '$lib/scheduling/reschedule-terms';
import { isAvailabilityDate } from '$lib/availability/windows';
import { zonedDate } from '$lib/availability/calculate';
import { sanitizePublicImageUrl } from '$lib/server/sites/public/public-image';
import { resolveMapsUrl } from '$lib/sites/location';
import { normalizeArgentineWhatsAppPhone } from '$lib/utils/phone';
import type { CitaSupabaseClient } from '$lib/types/database';
import { APPOINTMENT_STATUS_LABELS, isAppointmentStatus } from './appointments';
import { getAvailabilitySelection } from './availability';
import type { PublicAppointmentView } from './public-appointments';

import { managementId as uuid, managementRevision as token, managementCounter as counter, managementInstant as instant,
 managementEpochMicroseconds as epochMicroseconds, sameManagementInstant, parseManagementResult as parseCommandResult } from '../internal/management-contract';
export { sameManagementInstant } from '../internal/management-contract';
const nullableInstant = (value: unknown): string | null => value === null ? null : instant(value);

import type { PatientManagementAccess } from '$lib/scheduling/public-appointment';
export type { PatientManagementAccess } from '$lib/scheduling/public-appointment';
const invalid = (): never => { throw new InvalidDataContractError('appointment.management'); };
const money = (value: unknown): string => typeof value === 'string' && /^(0|[1-9]\d{0,127})$/.test(value) ? value : invalid();

/** Validate the explicit SQL projection, then construct only the patient DTO.
 * Unexpected provider/clinical/contact fields are never forwarded to the page.
 * Authority and economic calculations stay in SQL, including its sampled clock.
 */
export const parsePatientManagementView = (value: unknown) => {
 const row = readRecord(value, 'appointment.management');
 if (row.schema_version !== 1 || typeof row.status !== 'string' || !isAppointmentStatus(row.status) || !['legacy', 'capability'].includes(String(row.access_kind))) return invalid();
 const business = readRecord(row.business, 'appointment.management.business');
 const financial = readRecord(row.financial_summary, 'appointment.management.financialSummary');
 const professionalIds = readArray(row.professional_ids, 'appointment.management.professionals').map(uuid);
 if (professionalIds.length > 100 || new Set(professionalIds).size !== professionalIds.length) return invalid();
 const startsAt = instant(row.starts_at), endsAt = instant(row.ends_at), now = instant(row.now);
 if (epochMicroseconds(endsAt) <= epochMicroseconds(startsAt)) return invalid();
 const isPast = readBoolean(row.is_past, 'appointment.management.past');
 const canCancel = readBoolean(row.can_cancel, 'appointment.management.cancel');
 const canConfirm = readBoolean(row.can_confirm, 'appointment.management.confirm');
 const canReschedule = readBoolean(row.can_reschedule, 'appointment.management.reschedule');
 const canAddInformation = readBoolean(row.can_add_information, 'appointment.management.information');
 const canManageReminders = readBoolean(row.can_manage_reminders, 'appointment.management.reminders');
 const emailRemindersActive = row.email_reminders_active === true;
 const isActive = ['reserved', 'confirmed', 'reschedule_requested'].includes(row.status);
 if (isPast !== (epochMicroseconds(startsAt) <= epochMicroseconds(now)) || ((!isActive || isPast) && (canCancel || canConfirm || canReschedule || canAddInformation || canManageReminders)) ||
  (canConfirm && row.status !== 'reserved')) return invalid();
 const isBusinessActive = readBoolean(business.is_active, 'appointment.management.business.active');
 const publicBookingEnabled = readBoolean(business.public_booking_enabled, 'appointment.management.business.publicBooking');
 if ((!isBusinessActive && (canAddInformation || canManageReminders)) || (canAddInformation && !canManageReminders)) return invalid();
 const durationMinutes = row.reschedule_duration_minutes === null ? null : counter(row.reschedule_duration_minutes);
 if (canReschedule && (!professionalIds.length || !isBusinessActive || !publicBookingEnabled || durationMinutes === null)) return invalid();
 if (row.modality !== 'in_person' && row.modality !== 'video') return invalid();
 const modality: BookingModality = row.modality;
 const integration = row.integration === null ? null : (() => {
  const raw = readRecord(row.integration, 'appointment.management.integration');
  const theme = BOOKING_THEMES.find(candidate => candidate === raw.theme_snapshot);
  if (!theme || typeof raw.public_key !== 'string' || !BOOKING_INTEGRATION_KEY_PATTERN.test(raw.public_key) || raw.modality !== row.modality) return invalid();
  return { id: uuid(raw.id), revision: raw.revision === null ? null : counter(raw.revision),
   isActive: readBoolean(raw.is_active, 'appointment.management.integration.active'), publicKey: raw.public_key,
   theme, modality, videoInstructions: readNullableText(raw.video_instructions_snapshot, 'appointment.management.video'),
   modalityWindows: parseBookingModalityWindows(raw.modality_windows) };
 })();
 if (row.modality === 'video' && !integration) return invalid();
 const deposit = row.deposit === null ? null : parseAppointmentDeposit(row.deposit);
 if ((row.deposit !== null && !deposit) || (canConfirm && deposit?.status === 'pending')) return invalid();
 const context = integration ? { theme: integration.theme, modality: integration.modality, videoInstructions: integration.videoInstructions } : null;
 const appointment: PublicAppointmentView = {
  id: uuid(row.id), token: token(row.calendar_token), status: row.status, starts_at: startsAt, ends_at: endsAt,
  service_name_snapshot: readText(row.service_name_snapshot, 'appointment.management.service'),
  professional_name_snapshot: readText(row.professional_name_snapshot, 'appointment.management.professional'),
  professional_count: Math.max(1, professionalIds.length), is_joint: professionalIds.length > 1,
  calendar_action_status: readText(row.calendar_action_status, 'appointment.management.calendarStatus'),
  calendar_action_at: nullableInstant(row.calendar_action_at), calendar_action_count: counter(row.calendar_action_count, 0),
  calendar_sequence: counter(row.calendar_sequence, 0), calendar_update_required_at: nullableInstant(row.calendar_update_required_at),
  patient_name: readNullableText(row.patient_name, 'appointment.management.patientName'), booking_context: context,
  patient_instructions_snapshot: readNullableText(row.patient_instructions_snapshot, 'appointment.management.instructions'),
  public_reminder_description_snapshot: readNullableText(row.public_reminder_description_snapshot, 'appointment.management.reminderDescription'),
  price_quote_snapshot: parsePriceQuote(row.price_quote_snapshot), deposit,
  deposit_transfer_details: isActive && !isPast && deposit?.status === 'pending' ? readNullableText(row.deposit_transfer_details, 'appointment.management.transfer') : null,
  public_status_label: APPOINTMENT_STATUS_LABELS[row.status], public_actions_available: true,
  can_cancel: canCancel, can_confirm: canConfirm, can_request_reschedule: canReschedule, is_past: isPast,
  business: {
   id: uuid(business.id), name: readText(business.name, 'appointment.management.business.name'), slug: readText(business.slug, 'appointment.management.business.slug'),
   timezone: readText(business.timezone, 'appointment.management.timezone'), is_active: isBusinessActive,
   phone: readNullableText(business.phone, 'appointment.management.phone'), logo_url: sanitizePublicImageUrl(business.logo_url),
   address: row.modality === 'video' ? null : readNullableText(business.address, 'appointment.management.address'),
   address_instructions: row.modality === 'video' ? integration?.videoInstructions ?? null : readNullableText(business.address_instructions, 'appointment.management.placeInstructions'),
   maps_link: row.modality === 'video' ? null : resolveMapsUrl({ address: readNullableText(business.address, 'appointment.management.address'), maps_url: readNullableText(business.maps_url, 'appointment.management.maps') }),
   cancellation_policy: readNullableText(business.cancellation_policy, 'appointment.management.cancellationPolicy'),
   whatsapp_contact_phone: normalizeArgentineWhatsAppPhone(readNullableText(business.whatsapp_contact_phone, 'appointment.management.whatsapp'))
  }
 };
 const selfManagementCutoffHours =
  row.self_management_cutoff_hours === null || row.self_management_cutoff_hours === undefined
   ? null
   : counter(row.self_management_cutoff_hours);
 const selfManagementCutoffAt =
  row.self_management_cutoff_at === null || row.self_management_cutoff_at === undefined
   ? null
   : instant(row.self_management_cutoff_at);
 const selfManagementWindowClosed = row.self_management_window_closed === true;
 const cancelledByDepositExpiry =
  row.cancelled_by_deposit_expiry === true || (row.status === 'cancelled' && deposit?.status === 'expired');
 const depositCreditCutoffHours =
  row.deposit_credit_cutoff_hours === null || row.deposit_credit_cutoff_hours === undefined
   ? null
   : counter(row.deposit_credit_cutoff_hours);
 const cancellationDepositOutcome =
  row.cancellation_deposit_outcome === null || row.cancellation_deposit_outcome === undefined
   ? null
   : parseCancellationDepositOutcome(row.cancellation_deposit_outcome);
 return {
  appointment, canAddInformation, canManageReminders, emailRemindersActive, revision: token(row.revision), generation: counter(row.generation), scheduleRevision: counter(row.schedule_revision),
  accessKind: row.access_kind === 'legacy' ? 'legacy' as const : 'capability' as const, now,
  serviceId: row.service_id === null ? null : uuid(row.service_id), professionalIds, durationMinutes, integration,
  newBookingAllowed: readBoolean(row.new_booking_allowed, 'appointment.management.newBooking'),
  rescheduleUnavailableReason: readNullableText(row.reschedule_unavailable_reason, 'appointment.management.reason'),
  selfManagementCutoffHours,
  selfManagementCutoffAt,
  selfManagementWindowClosed,
  depositCreditCutoffHours,
  cancellationDepositOutcome,
  cancelledByDepositExpiry,
  financialTerms: row.financial_terms === null ? null : parseRescheduleFinancialTerms(row.financial_terms),
  financialSummary: { appliedAmount: money(financial.applied_amount), forfeitedAmount: money(financial.forfeited_amount), unresolvedAmount: money(financial.unresolved_amount) }
 };
};
export type PatientManagementView = ReturnType<typeof parsePatientManagementView>;

export const loadPatientManagementView = async (client: CitaSupabaseClient, access: PatientManagementAccess, startsAt: string | null = null): Promise<PatientManagementView | null> => {
 token(access.token);
 if (typeof access.legacy !== 'boolean') return invalid();
 if (startsAt !== null) instant(startsAt);
 const { data, error } = await client.rpc('get_patient_appointment_management_view', { p_token: access.token, p_legacy: access.legacy, p_starts_at: startsAt });
 if (error?.message === 'APPOINTMENT_LINK_UNAVAILABLE') return null;
 if (error) throw error;
 const view = parsePatientManagementView(data);
 if (view.accessKind !== (access.legacy ? 'legacy' : 'capability')) return invalid();
 return view;
};

/** No patient-controlled tenant, excluded appointment, team, service or modality. */
export const listPatientManagementSlots = async (client: CitaSupabaseClient, view: PatientManagementView, fromDate: string, toDate: string) => {
 if (!view.appointment.can_request_reschedule || !view.serviceId) throw new Error('APPOINTMENT_RESCHEDULE_UNAVAILABLE');
 if (!isAvailabilityDate(fromDate) || !isAvailabilityDate(toDate) || fromDate > toDate ||
  Date.parse(toDate) - Date.parse(fromDate) > 13 * 86400000) throw new Error('APPOINTMENT_RESCHEDULE_TIME_INVALID');
 const selection = await getAvailabilitySelection(client, {
  business: { id: view.appointment.business.id, is_active: true, public_booking_enabled: true,
   timezone: view.appointment.business.timezone, min_booking_notice_minutes: 0, max_booking_days_ahead: 365 },
  readScope: 'public', publicOnly: true, serviceId: view.serviceId, professionalIds: view.professionalIds,
  excludeAppointmentId: view.appointment.id, ignoreBreak: false, fromDate, toDate,
  modality: view.appointment.booking_context?.modality ?? 'in_person', modalityWindows: view.integration?.modalityWindows,
  maxSlots: 1500, maxSlotsPerDate: 150
 });
 if (selection.availabilityRevision === null || selection.durationMinutes !== view.durationMinutes) throw new Error('APPOINTMENT_AVAILABILITY_CHANGED');
 return selection;
};

export type PatientManagementCommand = {
 operationId: string; expectedRevision: string; action: 'cancel' | 'confirm' | 'reschedule';
 startsAt?: string | null; availabilityRevision?: number | null; integrationRevision?: number | null; financialTerms?: unknown;
};

/** Only the exact authorized receipt may bypass current-slot preflight. A new
 * move always uses the shared calculator and submits the patient's ORIGINAL
 * observed revision, availability version and financial conditions to SQL.
 */
export const applyPatientManagementCommand = async (client: CitaSupabaseClient, access: PatientManagementAccess, input: PatientManagementCommand) => {
 token(access.token); uuid(input.operationId); token(input.expectedRevision);
 if (typeof access.legacy !== 'boolean' || !['cancel', 'confirm', 'reschedule'].includes(input.action)) return invalid();
 const moving = input.action === 'reschedule';
 if (!moving && [input.startsAt, input.availabilityRevision, input.integrationRevision, input.financialTerms].some(value => value != null)) return invalid();
 const startsAt = moving ? instant(input.startsAt) : null;
 const terms = moving ? parseRescheduleFinancialTerms(input.financialTerms) : null;
 const args = {
  p_token: access.token, p_legacy: access.legacy, p_operation_id: input.operationId, p_expected_revision: input.expectedRevision,
  p_action: input.action, p_starts_at: startsAt, p_availability_revision: moving ? counter(input.availabilityRevision) : null,
  p_integration_revision: input.integrationRevision == null ? null : counter(input.integrationRevision), p_financial_terms: terms ? readJson(terms, 'appointment.management.command.terms') : null
 };
 if (moving) {
  const { data: cached, error: recoveryError } = await client.rpc('recover_patient_appointment_management', args);
  if (recoveryError) throw recoveryError;
  if (cached !== null) return parseCommandResult(cached);
  const view = await loadPatientManagementView(client, access, startsAt);
  if (!view) throw new Error('APPOINTMENT_LINK_UNAVAILABLE');
  if (view.revision !== input.expectedRevision) throw new Error('APPOINTMENT_MANAGEMENT_CHANGED');
  if ((view.integration?.revision ?? null) !== args.p_integration_revision) throw new Error('APPOINTMENT_AVAILABILITY_CHANGED');
  // A same-time operation is intentionally a SQL no-op. Never penalize or
  // manufacture a fresh obligation by selecting the already scheduled start.
  if (!sameManagementInstant(startsAt!, view.appointment.starts_at)) {
   const date = zonedDate(new Date(startsAt!), view.appointment.business.timezone);
   const selection = await listPatientManagementSlots(client, view, date, date);
   if (selection.availabilityRevision !== input.availabilityRevision) throw new Error('APPOINTMENT_AVAILABILITY_CHANGED');
   if (!selection.slots.some(slot => sameManagementInstant(slot.starts_at, startsAt!))) throw new Error('APPOINTMENT_SLOT_UNAVAILABLE');
  }
 }
 const { data, error } = await client.rpc('apply_patient_appointment_management', args);
 if (error) throw error;
 return parseCommandResult(data);
};

export const patientManagementErrorMessage = (error: unknown): string => {
 const candidate = error instanceof Error ? { message: error.message, code: '' } :
  typeof error === 'object' && error !== null ? error as { message?: unknown; code?: unknown } : {};
 const raw = typeof candidate.message === 'string' ? candidate.message : '';
 if (raw.includes('APPOINTMENT_LINK_UNAVAILABLE')) return 'Este enlace ya no está disponible. Pedile al consultorio un enlace actualizado.';
 if (raw.includes('APPOINTMENT_OPERATION_CONFLICT')) return 'Esta acción ya se utilizó con otros datos. Revisá el turno antes de continuar.';
 if (raw.includes('APPOINTMENT_MANAGEMENT_CHANGED') || raw.includes('APPOINTMENT_FINANCIAL_TERMS_CHANGED'))
  return 'El turno o sus condiciones cambiaron. Revisá la información actualizada antes de confirmar.';
 if (raw.includes('APPOINTMENT_AVAILABILITY_CHANGED') || raw.includes('APPOINTMENT_SLOT_UNAVAILABLE') || candidate.code === '23P01')
  return 'Ese horario cambió o dejó de estar disponible. Tu turno anterior se conserva; elegí otro horario.';
 if (raw.includes('APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED'))
  return 'Ya pasó el límite para cancelar o reprogramar este turno online. Escribile al consultorio para coordinar un cambio.';
 if (raw.includes('APPOINTMENT_RESCHEDULE_UNAVAILABLE') || raw.includes('APPOINTMENT_CANNOT_RESCHEDULE'))
  return 'No se puede reprogramar este turno online ahora. Tu turno se conserva; podés contactar al consultorio.';
 if (raw.includes('APPOINTMENT_CANNOT_CANCEL')) return 'Este turno ya no admite cancelación online. Revisá su estado y, si necesitás ayuda, contactá al consultorio.';
 if (raw.includes('APPOINTMENT_DEPOSIT_PENDING')) return 'El turno se confirma cuando el consultorio registra la seña. Si ya transferiste, enviales el comprobante.';
 if (raw.includes('APPOINTMENT_CANNOT_CONFIRM')) return 'Este turno ya no admite esa confirmación. Revisá su estado actual.';
 if (raw.includes('APPOINTMENT_RESCHEDULE_TIME_INVALID')) return 'Elegí un horario válido de la lista antes de continuar.';
 return 'No pudimos comprobar el resultado. Revisá el turno y volvé a intentar la misma acción; si sigue ocurriendo, contactá al consultorio.';
};

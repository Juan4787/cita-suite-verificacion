import { InvalidDataContractError, readArray, readBoolean, readChoice, readRecord, readText } from '$lib/contracts/json';
import { formatInTimeZone } from '$lib/utils/format';

export const EMAIL_POLICY_BOOLEAN_KEYS = ['email_enabled', 'require_email', 'show_cancel', 'show_reschedule', 'require_deposit_on_reschedule'] as const;
export type AppointmentEmailPreferences = Record<(typeof EMAIL_POLICY_BOOLEAN_KEYS)[number], boolean> & {
 previous_deposit_disposition: 'credit' | 'forfeit';
 self_management_cutoff_hours: number | null;
};
export const DEFAULT_APPOINTMENT_EMAIL_PREFERENCES: AppointmentEmailPreferences = {
 email_enabled: true, require_email: true, show_cancel: true, show_reschedule: true,
 require_deposit_on_reschedule: true, previous_deposit_disposition: 'forfeit',
 self_management_cutoff_hours: null
};

export const SELF_MANAGEMENT_CUTOFF_MAX_HOURS = 720;

export const computeSelfManagementCutoffAt = (startsAt: string, cutoffHours: number | null): Date | null => {
 if (cutoffHours === null || !Number.isSafeInteger(cutoffHours) || cutoffHours < 1) return null;
 const startMs = Date.parse(startsAt);
 if (!Number.isFinite(startMs)) return null;
 return new Date(startMs - cutoffHours * 3_600_000);
};

export const isSelfManagementWindowClosed = (startsAt: string, cutoffHours: number | null, now: Date): boolean => {
 const cutoff = computeSelfManagementCutoffAt(startsAt, cutoffHours);
 if (!cutoff) return false;
 return now.getTime() > cutoff.getTime();
};

/** Single source of truth for P5 self-management cutoff notices across booking, turn page and reschedule. */
export const buildSelfManagementCutoffNotice = (input: {
 startsAt: string;
 cutoffHours: number | null;
 timezone: string;
 now: Date;
 context: 'booking' | 'confirmed' | 'reschedule_target' | 'window_closed';
 hasWhatsApp?: boolean;
}): string | null => {
 if (input.cutoffHours === null || !Number.isSafeInteger(input.cutoffHours) || input.cutoffHours < 1) return null;
 const cutoff = computeSelfManagementCutoffAt(input.startsAt, input.cutoffHours);
 if (!cutoff) return null;
 const closed = input.now.getTime() > cutoff.getTime();
 const hoursLabel = input.cutoffHours === 1 ? '1\u00a0hora' : `${input.cutoffHours}\u00a0horas`;
 const cutoffLabel = formatInTimeZone(cutoff, input.timezone).full;

 if (input.context === 'window_closed') {
  const channel = input.hasWhatsApp ? 'por WhatsApp' : 'directamente';
  return `Los cambios y cancelaciones online se aceptan hasta ${hoursLabel} antes del turno (hasta el ${cutoffLabel}). Si necesitás cancelar o cambiar este turno, escribile al consultorio ${channel}.`;
 }
 if (input.context === 'reschedule_target') {
  if (!closed) return null;
  return `Si confirmás este horario, el turno quedará dentro de las últimas ${hoursLabel} antes de la consulta y ya no se podrá cancelar ni reprogramar online.`;
 }
 if (input.context === 'confirmed') {
  return closed
   ? `Este turno quedó dentro de las últimas ${hoursLabel} antes de la consulta y no se puede cancelar ni reprogramar online. Si necesitás un cambio, escribile al consultorio.`
   : `Podés cancelar o reprogramar este turno online hasta el ${cutoffLabel} (${hoursLabel} antes de la consulta).`;
 }
 return closed
  ? `Este turno está dentro de las últimas ${hoursLabel} antes de la consulta: una vez reservado no se podrá cancelar ni reprogramar online. Si necesitás un cambio, escribile al consultorio.`
  : `Podés cancelar o reprogramar este turno online hasta el ${cutoffLabel} (${hoursLabel} antes de la consulta).`;
};
/** Initial disclosure, distinct from the quote for an actual future move. */
export type BookingReschedulePolicy = {
 schema_version: 1;
 policy_revision: number;
 require_deposit_on_reschedule: boolean;
 previous_deposit_disposition: 'credit' | 'forfeit';
};
export const parseBookingReschedulePolicy = (value: unknown): BookingReschedulePolicy => {
 const row = readRecord(value, 'booking.reschedulePolicy');
 const keys = ['schema_version', 'policy_revision', 'require_deposit_on_reschedule', 'previous_deposit_disposition'];
 if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key)) || row.schema_version !== 1 ||
  typeof row.policy_revision !== 'number' || !Number.isSafeInteger(row.policy_revision) || row.policy_revision < 1)
  throw new InvalidDataContractError('booking.reschedulePolicy');
 return { schema_version: 1, policy_revision: row.policy_revision,
  require_deposit_on_reschedule: readBoolean(row.require_deposit_on_reschedule, 'booking.reschedulePolicy.requireDeposit'),
  previous_deposit_disposition: readChoice(row.previous_deposit_disposition, ['credit', 'forfeit'] as const, 'booking.reschedulePolicy.disposition') };
};

export type ManualBookingReschedulePolicy = { policy: BookingReschedulePolicy; excludedServiceIds: string[] };
export const parseManualBookingReschedulePolicy = (value: unknown): ManualBookingReschedulePolicy | null => {
 if (value === null) return null;
 const row = readRecord(value, 'manualBooking.reschedulePolicy');
 return { policy: parseBookingReschedulePolicy(row.policy), excludedServiceIds: readArray(row.excludedServiceIds, 'manualBooking.excludedServices')
  .map(id => readText(id, 'manualBooking.excludedService')) };
};

export const bookingReschedulePolicyNotice = (policy: BookingReschedulePolicy): string => {
 const previous = policy.previous_deposit_disposition === 'forfeit'
  ? 'esa seña no se aplicará al nuevo turno.' : 'esa seña seguirá a cuenta del turno.';
 const next = policy.require_deposit_on_reschedule
  ? 'En ese caso se pedirá una nueva seña, salvo que las señas a cuenta ya cubran el arancel conocido.'
  : 'En ese caso no se pedirá una nueva seña por el cambio.';
 return `Si reprogramás por tu cuenta después de pagar, ${previous} ${next} Si todavía no pagaste, se mantiene una sola seña pendiente.`;
};

/** One message of an appointment as the practice sees it. No provider identifiers. */
export type AppointmentEmailDelivery = {
 id: string;
 purpose: 'booking_receipt' | 'reschedule_receipt' | 'cancellation_receipt' | 'deposit_request' | 'reminder_72h' | 'reminder_24h';
 state: 'pending' | 'sending' | 'retry' | 'accepted' | 'delivered' | 'uncertain' | 'failed' | 'bounced' | 'complained' | 'discarded';
 recipient: string | null;
 createdAt: string;
 acceptedAt: string | null;
 deliveredAt: string | null;
 discardReason: string | null;
};

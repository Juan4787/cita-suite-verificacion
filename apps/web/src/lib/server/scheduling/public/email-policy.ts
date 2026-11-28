import type { CitaSupabaseClient } from '$lib/types/database';
import { readBoolean, readChoice, readFiniteNumber, readRecord } from '$lib/contracts/json';
import { EMAIL_POLICY_BOOLEAN_KEYS, parseBookingReschedulePolicy, type AppointmentEmailPreferences, type BookingReschedulePolicy, type ManualBookingReschedulePolicy } from '$lib/scheduling/email-policy';
import { loadDepositAutomationStatus, loadDepositPolicy } from './deposits';

export type AppointmentEmailPolicy = AppointmentEmailPreferences & { revision: number; sender_verified: boolean };

export const loadPublicBookingPolicy = async (supabase: CitaSupabaseClient, businessId: string) => {
 const policy = await loadAppointmentEmailPolicy(supabase, businessId);
 const reschedulePolicy: BookingReschedulePolicy = { schema_version: 1, policy_revision: policy.revision,
  require_deposit_on_reschedule: policy.require_deposit_on_reschedule, previous_deposit_disposition: policy.previous_deposit_disposition };
 return {
  requireEmail: policy.require_email && policy.sender_verified,
  reschedulePolicy,
  selfManagementCutoffHours: policy.self_management_cutoff_hours
 };
};

/** Loaded only when opening a staff booking, never with the agenda's lists. */
export const loadManualBookingReschedulePolicy = async (supabase: CitaSupabaseClient, businessId: string): Promise<ManualBookingReschedulePolicy | null> => {
 const [deposit, automation] = await Promise.all([loadDepositPolicy(supabase, businessId), loadDepositAutomationStatus(supabase)]);
 if (!deposit.enabled || !deposit.appliesToManual || !automation.enabled) return null;
 return {
  policy: (await loadPublicBookingPolicy(supabase, businessId)).reschedulePolicy,
  excludedServiceIds: deposit.excludedServiceIds,
  ...(deposit.depositCreditCutoffHours != null ? { depositCreditCutoffHours: deposit.depositCreditCutoffHours } : {})
 };
};

/** A staff checkbox records what the operator says they communicated. */
export const parseManualBookingRescheduleAttestation = (form: FormData): BookingReschedulePolicy | undefined => {
 const choices = form.getAll('reschedule_policy_acknowledged');
 if (choices.length > 1 || (choices.length && choices[0] !== 'true' && choices[0] !== '')) throw new Error('RESCHEDULE_POLICY_TERMS_INVALID');
 if (choices[0] !== 'true') return undefined;
 const terms = form.getAll('reschedule_policy_terms');
 try {
  if (terms.length !== 1 || typeof terms[0] !== 'string' || terms[0].length > 1024) throw new Error();
  return parseBookingReschedulePolicy(JSON.parse(terms[0]));
 } catch { throw new Error('RESCHEDULE_POLICY_TERMS_INVALID'); }
};

const revision = (value: unknown) => {
 const result = readFiniteNumber(value, 'emailPolicy.revision');
 if (!Number.isSafeInteger(result) || result < 1) throw new Error('EMAIL_POLICY_INVALID');
 return result;
};
const readCutoffHours = (value: unknown): number | null => {
 if (value === null || value === undefined) return null;
 const parsed = readFiniteNumber(value, 'emailPolicy.self_management_cutoff_hours');
 if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 720) throw new Error('EMAIL_POLICY_INVALID');
 return parsed;
};
export const loadAppointmentEmailPolicy = async (supabase: CitaSupabaseClient, businessId: string): Promise<AppointmentEmailPolicy> => {
 const { data, error } = await supabase.from('appointment_email_policies')
  .select('email_enabled, require_email, show_cancel, show_reschedule, require_deposit_on_reschedule, previous_deposit_disposition, self_management_cutoff_hours, revision, sender_verified')
  .eq('business_id', businessId).single();
 if (error) throw error;
 const row = readRecord(data, 'emailPolicy');
 return {
  email_enabled: readBoolean(row.email_enabled, 'emailPolicy.email_enabled'),
  require_email: readBoolean(row.require_email, 'emailPolicy.require_email'),
  show_cancel: readBoolean(row.show_cancel, 'emailPolicy.show_cancel'),
  show_reschedule: readBoolean(row.show_reschedule, 'emailPolicy.show_reschedule'),
  require_deposit_on_reschedule: readBoolean(row.require_deposit_on_reschedule, 'emailPolicy.require_deposit_on_reschedule'),
  previous_deposit_disposition: readChoice(row.previous_deposit_disposition, ['credit', 'forfeit'] as const, 'emailPolicy.previous_deposit_disposition'),
  self_management_cutoff_hours: readCutoffHours(row.self_management_cutoff_hours),
  revision: revision(row.revision), sender_verified: readBoolean(row.sender_verified, 'emailPolicy.sender_verified')
 };
};

export const parseAppointmentEmailPolicyForm = (form: FormData): { settings: AppointmentEmailPreferences; expectedRevision: number } => {
 for (const key of [...EMAIL_POLICY_BOOLEAN_KEYS, 'previous_deposit_disposition', 'self_management_cutoff_hours', 'expected_revision']) {
  if (form.getAll(key).length > 1) throw new Error('EMAIL_POLICY_INVALID');
 }
 const boolean = (key: (typeof EMAIL_POLICY_BOOLEAN_KEYS)[number]) => {
  const value = form.get(key);
  if (value !== null && value !== 'true') throw new Error('EMAIL_POLICY_INVALID');
  return value === 'true';
 };
 const rawRevision = form.get('expected_revision');
 if (typeof rawRevision !== 'string' || !/^[1-9]\d*$/.test(rawRevision)) throw new Error('EMAIL_POLICY_INVALID');
 const rawCutoff = form.get('self_management_cutoff_hours');
 let selfManagementCutoffHours: number | null = null;
 if (rawCutoff !== null) {
  if (typeof rawCutoff !== 'string') throw new Error('EMAIL_POLICY_INVALID');
  const trimmed = rawCutoff.trim();
  if (trimmed !== '') {
   if (!/^[1-9]\d{0,2}$/.test(trimmed)) throw new Error('EMAIL_POLICY_INVALID');
   const parsed = Number(trimmed);
   if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 720) throw new Error('EMAIL_POLICY_INVALID');
   selfManagementCutoffHours = parsed;
  }
 }
 return { expectedRevision: revision(Number(rawRevision)), settings: {
  email_enabled: boolean('email_enabled'), require_email: boolean('require_email'), show_cancel: boolean('show_cancel'),
  show_reschedule: boolean('show_reschedule'), require_deposit_on_reschedule: boolean('require_deposit_on_reschedule'),
  previous_deposit_disposition: readChoice(form.get('previous_deposit_disposition'), ['credit', 'forfeit'] as const, 'emailPolicy.previous_deposit_disposition'),
  self_management_cutoff_hours: selfManagementCutoffHours
 } };
};

export const saveAppointmentEmailPolicy = async (supabase: CitaSupabaseClient, businessId: string, input: ReturnType<typeof parseAppointmentEmailPolicyForm>) => {
 const { data, error } = await supabase.rpc('save_appointment_email_policy', {
  p_business_id: businessId, p_settings: input.settings, p_expected_revision: input.expectedRevision
 });
 if (error) throw error;
 return revision(data);
};

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPOINTMENT_EMAIL_PREFERENCES } from '$lib/scheduling/email-policy';
import { loadAppointmentEmailPolicy, loadPublicBookingPolicy, loadManualBookingReschedulePolicy, parseManualBookingRescheduleAttestation, parseAppointmentEmailPolicyForm, saveAppointmentEmailPolicy } from './email-policy';

const deposits = vi.hoisted(() => ({ loadDepositPolicy: vi.fn(), loadDepositAutomationStatus: vi.fn() }));
vi.mock('./deposits', () => deposits);

const businessId = '11111111-1111-4111-8111-111111111111';
const policy = { ...DEFAULT_APPOINTMENT_EMAIL_PREFERENCES, email_enabled: false, revision: 7, sender_verified: false };
const form = () => {
 const result = new FormData(); result.set('expected_revision', '7');
 for (const [key, value] of Object.entries(DEFAULT_APPOINTMENT_EMAIL_PREFERENCES)) if (value === true) result.set(key, 'true');
 result.set('previous_deposit_disposition', 'forfeit'); return result;
};
describe('appointment email preferences', () => {

 it.each([{ enabled: false, manual: true, automation: true }, { enabled: true, manual: false, automation: true }, { enabled: true, manual: true, automation: false }])(
  'does not ask staff to attest irrelevant deposit conditions: %j', async input => {
   deposits.loadDepositPolicy.mockResolvedValue({ enabled: input.enabled, appliesToManual: input.manual, excludedServiceIds: [] });
   deposits.loadDepositAutomationStatus.mockResolvedValue({ enabled: input.automation });
   const from = vi.fn();
   expect(await loadManualBookingReschedulePolicy({ from } as never, businessId)).toBeNull();
   expect(from).not.toHaveBeenCalled();
  }
 );
 it('loads only economic rules and excluded services for the staff disclosure', async () => {
  deposits.loadDepositPolicy.mockResolvedValue({ enabled: true, appliesToManual: true, excludedServiceIds: ['service-without-deposit'], transferDetails: 'Not part of this DTO' });
  deposits.loadDepositAutomationStatus.mockResolvedValue({ enabled: true });
  const query = { select: () => query, eq: () => query, single: async () => ({ data: policy, error: null }) };
  expect(await loadManualBookingReschedulePolicy({ from: () => query } as never, businessId)).toEqual({
   policy: { schema_version: 1, policy_revision: 7, require_deposit_on_reschedule: true, previous_deposit_disposition: 'forfeit' },
   excludedServiceIds: ['service-without-deposit']
  });
 });
 it('requires an explicit staff attestation before transporting any supplied rules', () => {
  const data = new FormData(); const terms = { schema_version: 1, policy_revision: 7, require_deposit_on_reschedule: true, previous_deposit_disposition: 'forfeit' };
  data.set('reschedule_policy_terms', JSON.stringify(terms));
  expect(parseManualBookingRescheduleAttestation(data)).toBeUndefined();
  data.set('reschedule_policy_acknowledged', 'true');
  expect(parseManualBookingRescheduleAttestation(data)).toEqual(terms);
  data.append('reschedule_policy_acknowledged', 'true');
  expect(() => parseManualBookingRescheduleAttestation(data)).toThrow('RESCHEDULE_POLICY_TERMS_INVALID');
 });
 it.each(['{broken', JSON.stringify({ schema_version: 1 }), JSON.stringify({ schema_version: 1, policy_revision: 7, require_deposit_on_reschedule: true, previous_deposit_disposition: 'forfeit', actor_id: 'forged' })])('rejects invalid staff disclosure %s', value => {
  const data = new FormData(); data.set('reschedule_policy_acknowledged', 'true'); data.set('reschedule_policy_terms', value);
  expect(() => parseManualBookingRescheduleAttestation(data)).toThrow('RESCHEDULE_POLICY_TERMS_INVALID');
 });
 it('keeps required email independent from disabled sending and readiness', async () => {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: policy, error: null }) };
  const from = vi.fn().mockReturnValue(query);
  expect(await loadAppointmentEmailPolicy({ from } as never, businessId)).toEqual(policy);
  expect(query.eq).toHaveBeenCalledWith('business_id', businessId);
 });
 it('projects only required contact when sender is ready and the versioned economic rules to public booking', async () => {
  const unreadyQuery = { select: () => unreadyQuery, eq: () => unreadyQuery, single: async () => ({ data: policy, error: null }) };
  expect(await loadPublicBookingPolicy({ from: () => unreadyQuery } as never, businessId)).toEqual({ requireEmail: false,
   reschedulePolicy: { schema_version: 1, policy_revision: 7, require_deposit_on_reschedule: true, previous_deposit_disposition: 'forfeit' }
  });
  const readyQuery = { select: () => readyQuery, eq: () => readyQuery, single: async () => ({ data: { ...policy, sender_verified: true }, error: null }) };
  expect(await loadPublicBookingPolicy({ from: () => readyQuery } as never, businessId)).toEqual({ requireEmail: true,
   reschedulePolicy: { schema_version: 1, policy_revision: 7, require_deposit_on_reschedule: true, previous_deposit_disposition: 'forfeit' }
  });
 });
 it.each([null, { ...policy, require_email: 'false' }, { ...policy, revision: 0 }, { ...policy, sender_verified: undefined }])('rejects an incomplete policy instead of enabling or disabling preferences by fallback', async data => {
  const query = { select: () => query, eq: () => query, single: async () => ({ data, error: null }) };
  await expect(loadAppointmentEmailPolicy({ from: () => query } as never, businessId)).rejects.toBeInstanceOf(Error);
 });
 it('parses unchecked controls independently without sending sender verification or an actor', () => {
  const input = form(); input.delete('email_enabled');
  expect(parseAppointmentEmailPolicyForm(input)).toEqual({ expectedRevision: 7, settings: { ...DEFAULT_APPOINTMENT_EMAIL_PREFERENCES, email_enabled: false } });
 });
 it.each(['false', 'on', '1'])('does not reinterpret a malformed checked value: %s', value => {
  const input = form(); input.set('require_email', value);
  expect(() => parseAppointmentEmailPolicyForm(input)).toThrow();
 });
 it('rejects duplicate fields and a missing economic decision', () => {
  const input = form(); input.append('expected_revision', '8');
  expect(() => parseAppointmentEmailPolicyForm(input)).toThrow();
  input.delete('expected_revision'); input.set('expected_revision', '7'); input.delete('previous_deposit_disposition');
  expect(() => parseAppointmentEmailPolicyForm(input)).toThrow();
 });
 it('uses one authenticated SQL command and preserves its revision conflict', async () => {
  const cause = { message: 'EMAIL_POLICY_CHANGED' }; const rpc = vi.fn().mockResolvedValue({ data: null, error: cause });
  const input = parseAppointmentEmailPolicyForm(form());
  await expect(saveAppointmentEmailPolicy({ rpc } as never, businessId, input)).rejects.toBe(cause);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('save_appointment_email_policy', { p_business_id: businessId, p_expected_revision: 7, p_settings: input.settings });
 });
 it.each([null, '8', 0, 1.5])('does not treat a malformed acknowledgment as a saved preference: %j', async data => {
  await expect(saveAppointmentEmailPolicy({ rpc: async () => ({ data, error: null }) } as never, businessId, parseAppointmentEmailPolicyForm(form()))).rejects.toThrow();
 });
});

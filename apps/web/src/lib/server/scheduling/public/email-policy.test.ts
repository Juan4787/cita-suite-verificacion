import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPOINTMENT_EMAIL_PREFERENCES, buildSelfManagementCutoffNotice } from '$lib/scheduling/email-policy';
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
   reschedulePolicy: { schema_version: 1, policy_revision: 7, require_deposit_on_reschedule: true, previous_deposit_disposition: 'forfeit' },
   selfManagementCutoffHours: null
  });
  const readyQuery = { select: () => readyQuery, eq: () => readyQuery, single: async () => ({ data: { ...policy, sender_verified: true, self_management_cutoff_hours: 48 }, error: null }) };
  expect(await loadPublicBookingPolicy({ from: () => readyQuery } as never, businessId)).toEqual({ requireEmail: true,
   reschedulePolicy: { schema_version: 1, policy_revision: 7, require_deposit_on_reschedule: true, previous_deposit_disposition: 'forfeit' },
   selfManagementCutoffHours: 48
  });
 });
 it.each([null, { ...policy, require_email: 'false' }, { ...policy, revision: 0 }, { ...policy, sender_verified: undefined }, { ...policy, self_management_cutoff_hours: 0 }, { ...policy, self_management_cutoff_hours: 721 }, { ...policy, self_management_cutoff_hours: 1.5 }, { ...policy, self_management_cutoff_hours: '48' }])('rejects an incomplete policy instead of enabling or disabling preferences by fallback', async data => {
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
 it('P5: acepta self_management_cutoff_hours vacío (null) o entre 1 y 720 y rechaza valores inválidos', () => {
  const blank = form(); blank.set('self_management_cutoff_hours', '');
  expect(parseAppointmentEmailPolicyForm(blank).settings.self_management_cutoff_hours).toBeNull();
  const valid = form(); valid.set('self_management_cutoff_hours', '48');
  expect(parseAppointmentEmailPolicyForm(valid).settings.self_management_cutoff_hours).toBe(48);
  for (const invalid of ['0', '721', '-1', '48.5', 'cuarenta']) {
   const bad = form(); bad.set('self_management_cutoff_hours', invalid);
   expect(() => parseAppointmentEmailPolicyForm(bad)).toThrow('EMAIL_POLICY_INVALID');
  }
 });
 it('P5: arma avisos claros de límite de autogestión fuera y dentro de la ventana', () => {
  const tz = 'America/Argentina/Buenos_Aires';
  const startsAt = '2026-12-20T13:00:00.000Z'; // 10:00 AR
  expect(buildSelfManagementCutoffNotice({ startsAt, cutoffHours: null, timezone: tz, now: new Date('2026-12-10T13:00:00.000Z'), context: 'booking' })).toBeNull();
  const outside = buildSelfManagementCutoffNotice({ startsAt, cutoffHours: 48, timezone: tz, now: new Date('2026-12-15T13:00:00.000Z'), context: 'booking' });
  expect(outside).toContain('48');
  expect(outside).toContain('18 de diciembre');
  expect(outside).toContain('10:00');
  const inside = buildSelfManagementCutoffNotice({ startsAt, cutoffHours: 48, timezone: tz, now: new Date('2026-12-19T13:00:00.000Z'), context: 'booking' });
  expect(inside).toMatch(/no se podrá cancelar ni reprogramar online/i);
  const rescheduleInside = buildSelfManagementCutoffNotice({ startsAt, cutoffHours: 48, timezone: tz, now: new Date('2026-12-19T13:00:00.000Z'), context: 'reschedule_target' });
  expect(rescheduleInside).toMatch(/ya no se podrá cancelar ni reprogramar online/i);
 });
});

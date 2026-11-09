import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: { BOOKING_INFORMATION_ENABLED: 'true', RATE_LIMIT_SALT: 'isolated-test-only' } }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { createPublicInformationPage } from './booking-information-page';
const token = 'a'.repeat(64);
const information = { theme: 'cita-suite', schema: [{ id: 'coverage', label: 'Cobertura', kind: 'text', required: false, maxLength: 100, patientField: 'insurance' }],
 schema_hash: 'b'.repeat(64), version: 'initial', answers: {}, comment: '', documents_enabled: true };
const event = (legacy: boolean, form?: URLSearchParams) => ({ params: { token }, locals: {}, fetch: vi.fn(), setHeaders: vi.fn(),
 getClientAddress: () => '127.0.0.1', request: new Request(`https://example.test/${legacy ? 'turno' : 'gestion'}/${token}/informacion`,
  form ? { method: 'POST', body: form } : undefined) }) as unknown as RequestEvent;
beforeEach(() => {
 mocks.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === 'consume_booking_integration_read_limit' ? true : name === 'submit_public_booking_information' ? '50000000-0000-4000-8000-000000000003' : information, error: null }));
});
describe('Clinical information explicit access channel', () => {
 for (const legacy of [true, false]) {
  it(`preserves ${legacy ? 'legacy' : 'capability'} authority in RPC and all navigation`, async () => {
   const data = await createPublicInformationPage(legacy).load(event(legacy));
   expect(mocks.rpc).toHaveBeenCalledWith('get_public_booking_information', { p_token: token, p_legacy: legacy });
   expect(data.managementUrl).toBe(`/${legacy ? 'turno' : 'gestion'}/${token}`);
   expect(data.documentsUrl).toBe(`${data.managementUrl}/documentos`);
  });
  it(`ignores form attempts to change the server-selected ${legacy ? 'legacy' : 'capability'} channel`, async () => {
   const form = new URLSearchParams({ request_key: '50000000-0000-4000-8000-000000000001', schema_hash: information.schema_hash,
    version: 'initial', intake_coverage: 'Current coverage', comment: 'My comment', p_legacy: String(!legacy), token: 'c'.repeat(64) });
   // Saved: back to the summary it came from, which says so.
   await expect(createPublicInformationPage(legacy).actions.save(event(legacy, form))).rejects.toMatchObject({
    status: 303, location: `/${legacy ? 'turno' : 'gestion'}/${token}?informacion=guardada` });
   expect(mocks.rpc).toHaveBeenCalledWith('submit_public_booking_information', expect.objectContaining({ p_token: token, p_legacy: legacy,
    p_request_key: form.get('request_key'), p_answers: { coverage: 'Current coverage' } }));
  });
 }
 it('names the practice for the tab, and still opens when the name cannot be read (plan 12.35)', async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'consume_booking_integration_read_limit' ? true
   : name === 'resolve_appointment_management_access' ? { business_id: '50000000-0000-4000-8000-000000000009' } : information, error: null }));
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: ' Consultorio Ramirez ' }, error: null }) }) }) });
  await expect(createPublicInformationPage(false).load(event(false))).resolves.toMatchObject({ businessName: 'Consultorio Ramirez', info: { version: 'initial' } });
  expect(mocks.rpc).toHaveBeenCalledWith('resolve_appointment_management_access', { p_token: token, p_legacy: false });
  mocks.from.mockImplementation(() => { throw new Error('unavailable'); });
  await expect(createPublicInformationPage(false).load(event(false))).resolves.toMatchObject({ businessName: null, info: { version: 'initial' } });
 });
 it('preserves the exact operation and entered values after an uncertain RPC response, also for native form rendering', async () => {
  mocks.rpc.mockImplementation(async (name: string) => name === 'submit_public_booking_information'
   ? { data: null, error: new Error('Response lost after possible commit') }
   : { data: name === 'consume_booking_integration_read_limit' ? true : information, error: null });
  const form = new URLSearchParams({ request_key: '50000000-0000-4000-8000-000000000001', schema_hash: information.schema_hash,
   version: 'initial', intake_coverage: 'Keep my answer', comment: 'Keep my comment' });
  const result = await createPublicInformationPage(false).actions.save(event(false, form));
  expect(result).toMatchObject({ status: 400, data: { saved: false, submitted: { answers: { coverage: 'Keep my answer' },
   requestKey: form.get('request_key'), schemaHash: information.schema_hash, version: 'initial', comment: 'Keep my comment' } } });
 });
 it('does not announce a committed submission when the RPC has no valid result, and preserves its request for recovery', async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'consume_booking_integration_read_limit' ? true : name === 'submit_public_booking_information' ? null : information, error: null }));
  const form = new URLSearchParams({ request_key: '50000000-0000-4000-8000-000000000001', schema_hash: information.schema_hash, version: 'initial', intake_coverage: 'Keep uncertain answer' });
  const result = await createPublicInformationPage(false).actions.save(event(false, form));
  expect(result).toMatchObject({ status: 400, data: { saved: false, message: expect.stringContaining('No pudimos comprobar el envío'), submitted: { requestKey: form.get('request_key'), answers: { coverage: 'Keep uncertain answer' } } } });
 });
 it('does not submit after SQL rejects the clinical read scope and shows no raw SQL details', async () => {
  mocks.rpc.mockImplementation(async (name: string) => name === 'get_public_booking_information'
   ? { data: null, error: new Error('BOOKING_INFORMATION_UNAVAILABLE') } : { data: true, error: null });
  const result = await createPublicInformationPage(false).actions.save(event(false, new URLSearchParams()));
  expect(result).toMatchObject({ status: 400, data: { saved: false } });
  expect(JSON.stringify(result)).not.toContain('BOOKING_INFORMATION_UNAVAILABLE');
  expect(mocks.rpc.mock.calls.some(([name]) => name === 'submit_public_booking_information')).toBe(false);
 });
});

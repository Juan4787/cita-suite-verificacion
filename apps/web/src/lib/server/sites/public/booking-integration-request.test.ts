import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ env: { BOOKING_INTEGRATIONS_ENABLED: 'true', DEMO_MODE: 'false' }, rpc: vi.fn(), load: vi.fn(), admin: vi.fn(), logFailure: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock('$lib/server/sites/public/booking-integrations', () => ({ loadBookingIntegration: mocks.load }));
vi.mock('$lib/server/platform/rate-limits', () => ({ hashRateLimitSubject: () => 'a'.repeat(64) }));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: mocks.logFailure }));
import { resolveBookingIntegrationRequest } from '$lib/server/sites/public/booking-integration-request';

const key = 'a'.repeat(32);
const instanceId = 'b'.repeat(32);
const integration = { id: 'integration', publicKey: key, allowedOrigins: ['https://natalia.example.test'] };
function event(query = ''): any {
  return { params: { integrationKey: key }, locals: {}, url: new URL('https://booking.example.test/embed/v1/' + key + query), fetch: vi.fn(), getClientAddress: () => '192.0.2.10', setHeaders: vi.fn() };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.env.BOOKING_INTEGRATIONS_ENABLED = 'true'; mocks.env.DEMO_MODE = 'false';
  mocks.rpc.mockResolvedValue({ data: true, error: null }); mocks.load.mockResolvedValue(integration);
  mocks.admin.mockResolvedValue({ rpc: mocks.rpc });
});
describe('public integration request isolation', () => {
  it('does no database work while disabled or in demo', async () => {
    mocks.env.BOOKING_INTEGRATIONS_ENABLED = 'false'; await expect(resolveBookingIntegrationRequest(event())).rejects.toMatchObject({ status: 503 });
    mocks.env.BOOKING_INTEGRATIONS_ENABLED = 'true'; mocks.env.DEMO_MODE = 'true';
    await expect(resolveBookingIntegrationRequest(event())).rejects.toMatchObject({ status: 503 }); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('rejects malformed keys before querying', async () => {
    const request = event(); request.params.integrationKey = 'guessed';
    await expect(resolveBookingIntegrationRequest(request)).rejects.toMatchObject({ status: 404 }); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('fails closed when the limiter cannot certify admission', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
    await expect(resolveBookingIntegrationRequest(event())).rejects.toMatchObject({ status: 503 }); expect(mocks.load).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: false, error: null }); const request = event();
    await expect(resolveBookingIntegrationRequest(request)).rejects.toMatchObject({ status: 429 }); expect(request.setHeaders).toHaveBeenCalledWith({ 'retry-after': '60' });
  });
  it.each(['?parent_origin=https://attacker.example.test&instance_id=' + instanceId, '?parent_origin=https://natalia.example.test.evil.test&instance_id=' + instanceId, '?parent_origin=https://natalia.example.test/path&instance_id=' + instanceId, '?parent_origin=https://natalia.example.test', '?instance_id=' + instanceId])('denies unsafe or incomplete frame context %s', async (query) => {
    const request = event(query); await expect(resolveBookingIntegrationRequest(request)).rejects.toMatchObject({ status: 403 }); expect(request.locals.bookingFrameAncestors).toBeUndefined();
  });
  it('allows only the exact parent and reuses configuration within the same request', async () => {
    const request = event('?parent_origin=https://natalia.example.test&instance_id=' + instanceId);
    expect((await resolveBookingIntegrationRequest(request)).embed).toEqual({ parentOrigin: 'https://natalia.example.test', instanceId });
    expect(request.locals.bookingFrameAncestors).toEqual(integration.allowedOrigins);
    await resolveBookingIntegrationRequest(request); expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.load).toHaveBeenCalledTimes(1);
    await resolveBookingIntegrationRequest(event()); expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it('coalesces layout and page loads that start before either has resolved', async () => {
    const request = event();
    const layout = resolveBookingIntegrationRequest(request);
    const page = resolveBookingIntegrationRequest(request);
    expect(await layout).toEqual(await page);
    expect(await page).not.toHaveProperty('supabase');
    expect(mocks.admin).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it('leaves framing denied for a standalone booking', async () => {
    const request = event(); expect((await resolveBookingIntegrationRequest(request)).embed).toBeNull(); expect(request.locals.bookingFrameAncestors).toBeUndefined();
  });
  it('turns unavailable or incompatible configuration into a human recovery action', async () => {
    mocks.load.mockRejectedValue(new Error('BOOKING_INTAKE_SCHEMA_INVALID private database detail'));
    await expect(resolveBookingIntegrationRequest(event())).rejects.toMatchObject({ status: 503, body: { message: 'No pudimos cargar las reservas. Esperá unos segundos y volvé a intentar o contactá al consultorio.' } });
    mocks.admin.mockRejectedValue(new Error('Missing private server credential'));
    await expect(resolveBookingIntegrationRequest(event())).rejects.toMatchObject({ status: 503 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('records why it answered 503, so an outage leaves a cause in the logs', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'database unavailable' } });
    await expect(resolveBookingIntegrationRequest(event())).rejects.toMatchObject({ status: 503 });
    mocks.rpc.mockResolvedValue({ data: true, error: null }); mocks.load.mockRejectedValue(new Error('BOOKING_INTAKE_SCHEMA_INVALID'));
    await expect(resolveBookingIntegrationRequest(event())).rejects.toMatchObject({ status: 503 });
    expect(mocks.logFailure).toHaveBeenCalledTimes(2);
  });
});

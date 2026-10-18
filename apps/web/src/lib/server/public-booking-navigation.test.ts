import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), state: vi.fn(), create: vi.fn(), verify: vi.fn(),
  lookup: vi.fn(), rpc: vi.fn(), resolve: vi.fn(), appointment: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: { DEMO_MODE: 'false' } }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock('$lib/server/patients/public/booking-information', () => ({
  bookingInformationEnabled: () => false,
  loadProfessionalBookingSchema: vi.fn(), informationErrorMessage: () => null,
}));
vi.mock('$lib/server/scheduling/public/public-booking', () => ({
  loadPublicBookingState: mocks.state, createPublicBooking: mocks.create,
  verifyTurnstileIfConfigured: mocks.verify, publicHash: () => 'safe-hash',
  getPublicBookingErrorMessage: () => 'No pudimos reservar.', getPublicBookingErrorCode: () => 'unknown',
}));
vi.mock('$lib/server/sites/public/booking-integration-request', () => ({ resolveBookingIntegrationRequest: mocks.resolve }));
vi.mock('$lib/server/scheduling/public/public-appointments', () => ({ loadPublicAppointmentByToken: mocks.appointment }));

import { loadPublicBookingPage, submitPublicBookingPage } from '$lib/server/scheduling/public/public-booking-page';
import { parseBookingIntegration } from '$lib/server/sites/public/booking-integrations';
import { load as receiptLoad } from '../../routes/embed/v1/[integrationKey]/turno/[token]/+page.server';

const businessId = '10000000-0000-4000-8000-000000000001';
const serviceId = '10000000-0000-4000-8000-000000000002';
const professionalId = '10000000-0000-4000-8000-000000000003';
const integrationId = '10000000-0000-4000-8000-000000000004';
const requestId = '10000000-0000-4000-8000-000000000005';
const key = 'a'.repeat(32), token = 'c'.repeat(64), instanceId = 'b'.repeat(32);
const frameQuery = '&parent_origin=https%3A%2F%2Fnatalia.example.test&instance_id=' + instanceId;
const integration = parseBookingIntegration({
  id: integrationId, business_id: businessId, public_key: key, revision: 2,
  is_active: true, is_default: true, contract_version: 1, theme: 'natalia',
  allowed_origins: ['https://natalia.example.test'], allowed_service_ids: [serviceId],
  allowed_professional_ids: [professionalId], allowed_modalities: ['in_person'],
  video_instructions: null, intake_schema: [], modality_windows: [],
});
const state = {
  business: { id: businessId, name: 'Consultorio de prueba', address: null },
  services: [{ id: serviceId, name: 'Consulta de prueba', duration_minutes: 30 }],
  professionals: [{ id: professionalId, name: 'Profesional de prueba' }],
  days: [], slots: [], issue: null,
};
function event(query = ''): any {
  return { params: { integrationKey: key, token }, fetch: vi.fn(), locals: {},
    url: new URL('https://booking.example.test/embed/v1/' + key + '?service_id=' + serviceId + query),
    setHeaders: vi.fn(), getClientAddress: () => '192.0.2.10' };
}
function submission(query = '') {
  const e = event(query);
  e.request = new Request(e.url, { method: 'POST', body: new URLSearchParams({
    service_id: serviceId, professional_id: professionalId,
    slot_starts_at: '2026-11-10T15:00:00Z', patient_name: 'Ana Prueba',
    patient_phone: '3415551234', idempotency_key: requestId,
    integration_revision: '2', modality: 'in_person',
  }) });
  return e;
}
beforeEach(() => {
  vi.clearAllMocks();
  const chain: any = {};
  for (const method of ['select', 'eq']) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = mocks.lookup;
  mocks.admin.mockResolvedValue({ rpc: mocks.rpc, from: vi.fn(() => chain) });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.lookup.mockResolvedValue({ data: { confirmation_token: token }, error: null });
  mocks.state.mockImplementation(async () => structuredClone(state));
  mocks.create.mockResolvedValue({ appointment: { confirmation_token: token } });
  mocks.verify.mockResolvedValue(undefined);
  mocks.resolve.mockResolvedValue({ integration, embed: null });
  mocks.appointment.mockResolvedValue({ booking_context: { theme: 'natalia' } });
});

describe('one Cita Suite flow for shared and Natalia links', () => {
  it('uses the same selection steps and state; the Natalia theme changes only presentation', async () => {
    const natalia = await loadPublicBookingPage(event(), integration);
    const native = await loadPublicBookingPage(event(), { ...integration, theme: 'cita-suite' });
    expect(natalia.state).toEqual(native.state);
    expect(natalia.selected).toEqual(native.selected);
    expect(natalia.presentation).toMatchObject({ compact: false, theme: 'natalia' });
    expect(native.presentation).toMatchObject({ compact: false, theme: 'cita-suite' });
    expect(mocks.state).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scope: { serviceIds: [serviceId], professionalIds: [professionalId] },
    }));
  });
  it('keeps the existing framed v1 selection behavior compatible', async () => {
    await expect(loadPublicBookingPage(event(frameQuery), integration)).rejects.toMatchObject({
      status: 303, location: expect.stringContaining('professional_id=' + professionalId),
    });
  });
  it('sends standalone confirmations directly to the full management page', async () => {
    await expect(submitPublicBookingPage(submission(), integration)).rejects.toMatchObject({ status: 303, location: '/turno/' + token + '?creado=1' });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: requestId,
      bookingIntegration: expect.objectContaining({ integrationId, integrationRevision: 2 }),
    }));
  });
  it('preserves the existing iframe receipt and its frame identity', async () => {
    await expect(submitPublicBookingPage(submission(frameQuery), integration)).rejects.toMatchObject({
      status: 303, location: '/embed/v1/' + key + '/turno/' + token + '?parent_origin=https%3A%2F%2Fnatalia.example.test&instance_id=' + instanceId + '&creado=1',
    });
  });
  it('recovers a standalone booking into the same full management page without creating it again', async () => {
    await expect(loadPublicBookingPage(event('&recover=1&request_id=' + requestId), integration)).rejects.toMatchObject({ status: 303, location: '/turno/' + token + '?recuperado=1' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it('recovers a framed booking without breaking the SDK identity', async () => {
    await expect(loadPublicBookingPage(event(frameQuery + '&recover=1&request_id=' + requestId), integration)).rejects.toMatchObject({
      status: 303, location: '/embed/v1/' + key + '/turno/' + token + '?recuperado=1&parent_origin=https%3A%2F%2Fnatalia.example.test&instance_id=' + instanceId,
    });
  });
  it('redirects old standalone receipt links only after validating the integration and appointment', async () => {
    await expect(receiptLoad(event('&creado=1&recuperado=1'))).rejects.toMatchObject({ status: 303, location: '/turno/' + token + '?creado=1&recuperado=1' });
    expect(mocks.appointment).toHaveBeenCalledWith(expect.anything(), token, expect.any(Date), integrationId);
    expect(mocks.admin).toHaveBeenCalledWith('odonto', expect.any(Function));
    mocks.appointment.mockResolvedValue(null);
    await expect(receiptLoad(event())).rejects.toMatchObject({ status: 404 });
  });
});

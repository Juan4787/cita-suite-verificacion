import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { createPatientManagementPage } from './patient-management-page';
import { demoPublicAppointment } from './public-appointments';
const mock = vi.hoisted(() => ({
 client: { rpc: vi.fn() }, screen: vi.fn(), submit: vi.fn(), calendarState: vi.fn(), calendarSync: vi.fn(), mark: vi.fn()
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: async () => mock.client }));
vi.mock('./patient-management-flow', () => ({ loadPatientManagementScreen: mock.screen, submitPatientManagementAction: mock.submit }));
vi.mock('$lib/server/integrations/public/calendar-tracking', () => ({ canRegisterCalendarAction: () => false, markCalendarOffered: mock.mark }));
vi.mock('$lib/server/integrations/public/google-calendar', () => ({
 loadGoogleCalendarUiState: mock.calendarState, processAppointmentGoogleCalendarSync: mock.calendarSync,
 getGoogleCalendarPublicMessage: () => null, requestGoogleCalendarEventDeletion: vi.fn()
}));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: vi.fn() }));
const token = 'a'.repeat(64);
const event = (): RequestEvent => ({ params: { token }, fetch: vi.fn(), url: new URL(`https://app.test/gestion/${token}`),
 request: new Request(`https://app.test/gestion/${token}`, { headers: { 'user-agent': 'Googlebot' } }), setHeaders: vi.fn(), getClientAddress: () => '192.0.2.4'
} as unknown as RequestEvent);
beforeEach(() => {
 vi.clearAllMocks(); mock.client.rpc.mockResolvedValue({ data: true, error: null });
 mock.calendarState.mockResolvedValue({ available: false, state: 'none', current: false, reminderLabel: 'antes del turno' });
 mock.screen.mockResolvedValue({ view: { appointment: demoPublicAppointment('b'.repeat(64)), newBookingAllowed: false, canManageReminders:true,canAddInformation:true }, panel: null });
});
describe('public appointment route delegation', () => {
 it.each([false, true])('uses the explicit legacy channel %s without guessing from identical token formats', async legacy => {
  const e = event(); await createPatientManagementPage(legacy).load(e);
  expect(mock.screen).toHaveBeenCalledExactlyOnceWith(mock.client, { token, legacy }, e.url);
  expect(e.setHeaders).toHaveBeenCalledWith(expect.objectContaining({ 'cache-control': 'no-store', 'referrer-policy': 'same-origin', 'x-robots-tag': expect.stringContaining('noindex') }));
 });
 it('does not fall back to the stable calendar token after a revoked management link', async () => {
  mock.screen.mockResolvedValue(null);
  const loaded = await createPatientManagementPage(true).load(event());
  expect(loaded.appointment).toBeNull(); expect(mock.screen).toHaveBeenCalledTimes(1);
  expect(mock.calendarState).not.toHaveBeenCalled(); expect(mock.mark).not.toHaveBeenCalled();
 });
 it('keeps minimum cancellation scope free of reminder offers and calendar tracking', async () => {
  mock.screen.mockResolvedValue({view:{appointment:demoPublicAppointment('b'.repeat(64)),newBookingAllowed:false,canManageReminders:false,canAddInformation:false},panel:null});
  mock.calendarState.mockResolvedValue({available:true,state:'active',current:true,reminderLabel:'antes del turno'});
  const loaded=await createPatientManagementPage(false).load(event());
  expect(loaded).toMatchObject({remindersEnabled:false,bookingInformationEnabled:false,androidCalendarIntent:null,googleCalendar:{available:false,state:'active'}});
  expect(mock.mark).not.toHaveBeenCalled();
 });
 it('keeps a rejected stale/expired operation as a failure with its original retry data', async () => {
  const feedback = { success: false, message: 'El turno cambió.', submitted: { expected_revision: 'old' }, retrySameOperation: false };
  mock.submit.mockResolvedValue(feedback);
  const action = createPatientManagementPage(false).actions.cancel;
  const result = await action!(event());
  expect(result).toMatchObject({ status: 409, data: feedback });
  expect(mock.submit).toHaveBeenCalledWith(mock.client, { token, legacy: false }, 'cancel', expect.any(Request));
  expect(mock.calendarSync).not.toHaveBeenCalled();
 });
 it('preserves a successful local command if the external calendar synchronization fails', async () => {
  mock.submit.mockResolvedValue({ success: true, message: 'La cancelación quedó registrada.', result: { appointmentId: 'owned-appointment', changed: true } });
  mock.calendarSync.mockRejectedValue(new Error('provider offline'));
  expect(await createPatientManagementPage(false).actions.cancel!(event())).toMatchObject({ success: true });
  expect(mock.calendarSync).toHaveBeenCalledWith(mock.client, 'owned-appointment', expect.anything());
 });
 it('does not let the legacy request-reschedule action create another manual request', async () => {
  const result = await createPatientManagementPage(true).actions.request_reschedule!(event());
  expect(result).toMatchObject({ status: 409 }); expect(mock.submit).not.toHaveBeenCalled();
 });
 it('blocks excess requests without attempting an agenda command', async () => {
  mock.client.rpc.mockResolvedValue({ data: false, error: null });
  const result = await createPatientManagementPage(false).actions.reschedule!(event());
  expect(result).toMatchObject({ status: 429 }); expect(mock.submit).not.toHaveBeenCalled();
 });
 it('P5: conserva management.practiceWhatsApp dentro de la ventana cerrada aunque haya seña pendiente', async () => {
  const base = demoPublicAppointment('b'.repeat(64));
  const appointment = {
   ...base,
   status: 'reserved' as const,
   is_past: false,
   business: { ...base.business, whatsapp_contact_phone: '5493415550199' },
   deposit: {
    status: 'pending' as const,
    amount: 40000,
    currency: 'ARS',
    due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    request_from: new Date().toISOString(),
    auto_cancel: false,
    transfer_details: 'Alias prueba',
    recorded_at: null
   }
  };
  mock.screen.mockResolvedValue({
   view: { appointment, newBookingAllowed: true, canManageReminders: true, canAddInformation: false },
   panel: {
    mode: 'overview',
    url: `/turno/${token}`,
    now: new Date().toISOString(),
    startsAt: appointment.starts_at,
    timezone: appointment.business.timezone,
    revision: 'rev-1',
    operationId: 'op-1',
    canConfirm: true,
    canCancel: false,
    canReschedule: false,
    selfManagementCutoffHours: 48,
    selfManagementCutoffAt: new Date(Date.now() - 3600_000).toISOString(),
    selfManagementWindowClosed: true,
    practicePhone: '+54 341 555-0199',
    unavailableMessage: null,
    date: '2026-12-01',
    minDate: '2026-11-28',
    maxDate: '2026-12-28',
    slots: [],
    selectedStart: null,
    availabilityRevision: null,
    durationMinutes: 60,
    financialTerms: null,
    financialSummary: { paidAmount: '0', appliedAmount: '0', creditedAmount: '0', forfeitedAmount: '0', unresolvedAmount: '0' }
   }
  });
  const loaded = await createPatientManagementPage(true).load(event());
  expect(loaded.depositWhatsApp).not.toBeNull();
  expect(loaded.practiceWhatsApp).toBeNull();
  expect(loaded.management?.practiceWhatsApp?.whatsappUrl).toContain('https://wa.me/5493415550199');
  expect(loaded.management?.practiceWhatsApp?.whatsappWebUrl).toContain('https://web.whatsapp.com/send?phone=5493415550199');
 });
});

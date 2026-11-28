import { describe, expect, it, vi } from 'vitest';
import { loadPatientManagementView, parsePatientManagementView, listPatientManagementSlots, applyPatientManagementCommand, patientManagementErrorMessage } from './patient-management';
import { ManagementResultUncertainError } from '../internal/management-contract';
import { getAvailabilitySelection } from './availability';
vi.mock('./availability', () => ({ getAvailabilitySelection: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const terms = () => ({ kind: 'none', unavailable_reason: null, required: false, amount: null, base_amount: null, currency: 'ARS',
 previous_applicable_payment_amount: '0', previous_payment_disposition: 'none', forfeit_amount: '0', credit_amount: '0',
 quote_amount: null, quote_remainder: null, request_from: null, due_at: null, auto_cancel: false, last_minute: false,
 terms_informed: false, current_deposit_status: null, current_deposit_amount: null, current_payment_allocation: null,
 request_days: null, deadline_hours: null, min_payment_hours: null });
const fixture = () => ({
 schema_version: 1, id: id(1), revision: 'a'.repeat(64), generation: 1, schedule_revision: 1, access_kind: 'capability',
 status: 'reserved', starts_at: '2026-12-01T12:00:00+00:00', ends_at: '2026-12-01T12:30:00+00:00', now: '2026-11-03T14:00:00+00:00',
 calendar_token: 'b'.repeat(64), patient_name: 'Paciente sintético', service_name_snapshot: 'Consulta', professional_name_snapshot: 'Profesional',
 service_id: id(2), professional_ids: [id(3)], reschedule_duration_minutes: 45, modality: 'in_person', integration: null,
 patient_instructions_snapshot: null, public_reminder_description_snapshot: null, price_quote_snapshot: null,
 calendar_action_status: 'not_offered', calendar_action_at: null, calendar_action_count: 0, calendar_sequence: 0, calendar_update_required_at: null,
 deposit: null, deposit_transfer_details: null, financial_terms: null,
 financial_summary: { applied_amount: '0', forfeited_amount: '0', unresolved_amount: '0' },
 can_cancel: true, can_confirm: true, can_reschedule: true, can_add_information: true, can_manage_reminders: true, is_past: false, new_booking_allowed: false, reschedule_unavailable_reason: null,
 business: { id: id(4), name: 'Consultorio', slug: 'consultorio', timezone: 'America/Argentina/Cordoba', phone: null,
  address: 'Dirección', address_instructions: 'Timbre', maps_url: null, logo_url: null, is_active: true,
  public_booking_enabled: true, cancellation_policy: null, whatsapp_contact_phone: null }
});

describe('patient management command adapter', () => {
 const access = { token: 'c'.repeat(64), legacy: false };
 const move = () => ({ operationId: id(8), expectedRevision: 'a'.repeat(64), action: 'reschedule' as const,
  startsAt: '2026-12-02T12:00:00.000Z', availabilityRevision: 9, integrationRevision: null, financialTerms: terms() });
 const result = () => ({ appointment_id: id(1), changed: true, status: 'reserved', starts_at: move().startsAt,
  ends_at: '2026-12-02T12:45:00.000Z', schedule_revision: 2, revision: 'd'.repeat(64), idempotent_replay: false });
 const client = () => ({ rpc: vi.fn().mockImplementation(async (name: string) => ({ error: null, data:
  name === 'recover_patient_appointment_management' ? null : name === 'get_patient_appointment_management_view' ? { ...fixture(), financial_terms: terms() } : result()
 })) });
 it('checks the real selected slot before mutation, retaining the observed revision and accepted conditions', async () => {
  const db = client(); const selected = move();
  vi.mocked(getAvailabilitySelection).mockResolvedValue({ slots: [{ date: '2026-12-02', time: '09:00', starts_at: selected.startsAt,
   ends_at: result().ends_at, professional_id: id(3), professional_name: 'Profesional' }], configurationRevision: 4, availabilityRevision: 9, durationMinutes: 45 });
  await applyPatientManagementCommand(db as never, access, selected);
  expect(db.rpc).toHaveBeenLastCalledWith('apply_patient_appointment_management', {
   p_token: access.token, p_legacy: false, p_operation_id: id(8), p_expected_revision: selected.expectedRevision,
   p_action: 'reschedule', p_starts_at: selected.startsAt, p_availability_revision: 9, p_integration_revision: null, p_financial_terms: terms()
  });
 });
 it('recovers an exact lost response before availability when the appointment has already moved', async () => {
  const cached = { ...result(), idempotent_replay: true }; const rpc = vi.fn().mockResolvedValue({ data: cached, error: null });
  vi.mocked(getAvailabilitySelection).mockClear();
  expect((await applyPatientManagementCommand({ rpc } as never, access, move())).idempotentReplay).toBe(true);
  expect(rpc).toHaveBeenCalledTimes(1); expect(getAvailabilitySelection).not.toHaveBeenCalled();
 });
 it('preserves uncertainty when an existing operation receipt cannot be decoded, without executing another command', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { status: 'reserved' }, error: null });
  vi.mocked(getAvailabilitySelection).mockClear();
  await expect(applyPatientManagementCommand({ rpc } as never, access, move())).rejects.toBeInstanceOf(ManagementResultUncertainError);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('recover_patient_appointment_management', expect.objectContaining({ p_operation_id: move().operationId }));
  expect(getAvailabilitySelection).not.toHaveBeenCalled();
 });
 it('never replaces an old observed revision with a fresh read', async () => {
  const db = client();
  await expect(applyPatientManagementCommand(db as never, access, { ...move(), expectedRevision: 'e'.repeat(64) })).rejects.toThrow('APPOINTMENT_MANAGEMENT_CHANGED');
  expect(db.rpc.mock.calls.some(call => call[0] === 'apply_patient_appointment_management')).toBe(false);
 });
 it('rejects a sub-millisecond forged slot instead of truncating it into an available instant', async () => {
  const db = client();
  vi.mocked(getAvailabilitySelection).mockResolvedValue({ slots: [{ date: '2026-12-02', time: '09:00', starts_at: move().startsAt,
   ends_at: result().ends_at, professional_id: id(3), professional_name: 'Profesional' }], configurationRevision: 4, availabilityRevision: 9, durationMinutes: 45 });
  await expect(applyPatientManagementCommand(db as never, access, { ...move(), startsAt: '2026-12-02T12:00:00.000001Z' })).rejects.toThrow('APPOINTMENT_SLOT_UNAVAILABLE');
  expect(db.rpc.mock.calls.some(call => call[0] === 'apply_patient_appointment_management')).toBe(false);
 });
 it('rejects a changed availability version and an unavailable chosen slot without mutation', async () => {
  for (const revision of [8, 9]) {
   const db = client(); vi.mocked(getAvailabilitySelection).mockResolvedValue({ slots: [], configurationRevision: 4, availabilityRevision: revision, durationMinutes: 45 });
   await expect(applyPatientManagementCommand(db as never, access, move())).rejects.toThrow();
   expect(db.rpc.mock.calls.some(call => call[0] === 'apply_patient_appointment_management')).toBe(false);
  }
 });
 it('does not turn cancel/confirm into a reschedule or require public availability for cancellation', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { ...result(), status: 'cancelled' }, error: null });
  vi.mocked(getAvailabilitySelection).mockClear();
  await applyPatientManagementCommand({ rpc } as never, access, { operationId: id(8), expectedRevision: 'a'.repeat(64), action: 'cancel' });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('apply_patient_appointment_management', expect.objectContaining({ p_action: 'cancel', p_starts_at: null, p_financial_terms: null }));
  expect(getAvailabilitySelection).not.toHaveBeenCalled();
 });
 it('preserves an uncertain request for exact retry rather than telling the patient no change was saved', () => {
  const message = patientManagementErrorMessage(new Error('network timeout'));
  expect(message).toMatch(/comprobar|revisá/i); expect(message).not.toMatch(/no se guardó|network|timeout|RPC|SQL/);
 });
});

describe('patient management snapshot boundary', () => {
 it('uses the server clock, fixed appointment/team identity and current duration without changing the scheduled interval', () => {
  const view = parsePatientManagementView(fixture());
  expect(view.appointment.id).toBe(id(1));
  expect(view.professionalIds).toEqual([id(3)]);
  expect(view.durationMinutes).toBe(45);
  expect(view.appointment.ends_at).toBe('2026-12-01T12:30:00+00:00');
  expect(view.now).toBe('2026-11-03T14:00:00+00:00');
 });
 it('does not serialize unexpected private fields from the response', () => {
  const row = { ...fixture(), patient_email: 'private@example.test', internal_note: 'private clinical note' };
  expect(JSON.stringify(parsePatientManagementView(row))).not.toContain('private');
 });
 it.each(['revision', 'generation', 'status', 'starts_at', 'can_cancel', 'professional_ids', 'schema_version'])(
  'rejects an absent required %s rather than inventing defaults', key => {
   const row: Record<string, unknown> = fixture(); delete row[key];
   expect(() => parsePatientManagementView(row)).toThrow();
  });
 it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'])('rejects unsafe revision counters %s', value => {
  expect(() => parsePatientManagementView({ ...fixture(), generation: value })).toThrow();
 });
 it('rejects unknown financial amounts instead of treating them as zero', () => {
  expect(() => parsePatientManagementView({ ...fixture(), financial_summary: { applied_amount: null, forfeited_amount: '0', unresolved_amount: '0' } })).toThrow();
 });
 it('sanitizes public links/images and never shows a physical address for video', () => {
  const row = fixture();
  const view = parsePatientManagementView({ ...row, modality: 'video', integration: {
   id: id(5), revision: 3, is_active: true, public_key: 'a'.repeat(32), theme_snapshot: 'natalia', entry_point: 'public_page',
   modality: 'video', video_instructions_snapshot: 'Acceso virtual', modality_windows: []
  }, business: { ...row.business, logo_url: 'javascript:alert(1)', maps_url: 'javascript:alert(1)' } });
  expect(view.appointment.business.address).toBeNull(); expect(view.appointment.business.maps_link).toBeNull();
  expect(view.appointment.business.address_instructions).toBe('Acceso virtual'); expect(view.appointment.business.logo_url).toBeNull();
 });
 it('retains only the narrow cancellation permission when public booking is off', () => {
  const row = fixture();
  const view = parsePatientManagementView({ ...row, can_reschedule: false, can_confirm: false, can_add_information: false, can_manage_reminders: false,
   business: { ...row.business, is_active: false, public_booking_enabled: false } });
  expect(view.appointment.can_cancel).toBe(true); expect(view.appointment.can_request_reschedule).toBe(false);
 });
 it('keeps reminders independent of moving slots and requires explicit auxiliary flags', () => {
  const row=fixture(); const view=parsePatientManagementView({...row,can_reschedule:false,can_add_information:false});
  expect(view.canManageReminders).toBe(true); expect(view.canAddInformation).toBe(false);
  for(const key of ['can_add_information','can_manage_reminders']) {
   const incomplete={...row}; delete incomplete[key as keyof typeof incomplete];
   expect(()=>parsePatientManagementView(incomplete)).toThrow();
  }
  expect(()=>parsePatientManagementView({...row,can_manage_reminders:false})).toThrow();
 });
 it('does not trust contradictory closed/past action permissions', () => {
  expect(() => parsePatientManagementView({ ...fixture(), status: 'cancelled' })).toThrow();
  expect(() => parsePatientManagementView({ ...fixture(), is_past: true })).toThrow();
 });
 it('reads capability and legacy channels explicitly through the one RPC without issuing another credential', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: fixture(), error: null });
  await loadPatientManagementView({ rpc } as never, { token: 'c'.repeat(64), legacy: false });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('get_patient_appointment_management_view', {
   p_token: 'c'.repeat(64), p_legacy: false, p_starts_at: null
  });
 });
 it('returns unavailable uniformly for a revoked/unknown link, without a fallback raw-token query', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'APPOINTMENT_LINK_UNAVAILABLE' } });
  expect(await loadPatientManagementView({ rpc } as never, { token: 'c'.repeat(64), legacy: false })).toBeNull();
  expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('preserves service failures as failures and never disguises them as a missing appointment', async () => {
  const error = { message: 'connection failed' }; const rpc = vi.fn().mockResolvedValue({ data: null, error });
  await expect(loadPatientManagementView({ rpc } as never, { token: 'c'.repeat(64), legacy: true })).rejects.toBe(error);
 });
 it('fixes exclusion, team, service and modality in the authorized snapshot; returns versions from the calculation', async () => {
  vi.mocked(getAvailabilitySelection).mockResolvedValue({ slots: [], configurationRevision: 4, availabilityRevision: 9, durationMinutes: 45 });
  const view = parsePatientManagementView(fixture());
  const selection = await listPatientManagementSlots({} as never, view, '2026-12-02', '2026-12-03');
  expect(selection.availabilityRevision).toBe(9);
  expect(getAvailabilitySelection).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
   excludeAppointmentId: id(1), professionalIds: [id(3)], serviceId: id(2), readScope: 'public', publicOnly: true, ignoreBreak: false
  }));
 });
 it('does not query availability for an unauthorized move or an unbounded date range', async () => {
  vi.mocked(getAvailabilitySelection).mockClear();
  const view = parsePatientManagementView({ ...fixture(), can_reschedule: false });
  await expect(listPatientManagementSlots({} as never, view, '2026-12-02', '2026-12-03')).rejects.toThrow();
  await expect(listPatientManagementSlots({} as never, parsePatientManagementView(fixture()), '2026-12-01', '2027-01-01')).rejects.toThrow();
  expect(getAvailabilitySelection).not.toHaveBeenCalled();
 });
 it('rejects a missing availability revision instead of fetching a newer unrelated version', async () => {
  vi.mocked(getAvailabilitySelection).mockResolvedValue({ slots: [], configurationRevision: 4, availabilityRevision: null, durationMinutes: 45 });
  await expect(listPatientManagementSlots({} as never, parsePatientManagementView(fixture()), '2026-12-02', '2026-12-03')).rejects.toThrow();
 });
 it('P5: traduce APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED y lee los metadatos de ventana del snapshot', () => {
  const message = patientManagementErrorMessage(new Error('APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED'));
  expect(message).toMatch(/límite.*cancelar o reprogramar/i);
  expect(message).not.toContain('APPOINTMENT_');

  const closedView = parsePatientManagementView({
   ...fixture(),
   can_cancel: false,
   can_reschedule: false,
   self_management_cutoff_hours: 48,
   self_management_cutoff_at: '2026-11-29T12:00:00+00:00',
   self_management_window_closed: true
  });
  expect(closedView.selfManagementCutoffHours).toBe(48);
  expect(closedView.selfManagementCutoffAt).toBe('2026-11-29T12:00:00+00:00');
  expect(closedView.selfManagementWindowClosed).toBe(true);
 });
});

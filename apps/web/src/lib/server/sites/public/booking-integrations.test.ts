import { describe, expect, it, vi } from 'vitest';
import { normalizeBookingOrigin, parseBookingIntakeFields, parseBookingModalityWindows, validateBookingIntakeAnswers, isBookingHostMessage } from '@cita-suite/shared/booking-integration';
import { parseBookingIntegration, assertIntegrationSelection, bookingPresentation, intakeAnswersFromForm, integratedBookingErrorMessage } from '$lib/server/sites/public/booking-integrations';
import { readBoundedBookingForm } from '$lib/server/platform/form-data';
import { createManualAppointment } from '$lib/server/scheduling/public/appointments';
import { calculateAvailabilitySlots } from '$lib/availability/calculate';

const businessId = '10000000-0000-4000-8000-000000000001';
const serviceId = '10000000-0000-4000-8000-000000000002';
const professionalId = '10000000-0000-4000-8000-000000000003';
const integrationId = '10000000-0000-4000-8000-000000000004';
const requestId = '10000000-0000-4000-8000-000000000005';
const schema = [{ id: 'insurance', label: 'Obra social', kind: 'text', required: true, maxLength: 120 }, { id: 'labs', label: 'Estudios', kind: 'boolean', required: false }];
const row = {
  id: integrationId, business_id: businessId, public_key: 'a'.repeat(32), revision: 2,
  is_active: true, is_default: true, contract_version: 1, theme: 'natalia',
  allowed_origins: ['https://natalia.example.test'], allowed_service_ids: [serviceId],
  allowed_professional_ids: [professionalId], allowed_modalities: ['in_person', 'video'],
  video_instructions: 'Indicaciones reservadas para el paciente.', intake_schema: schema, modality_windows: []
};

describe('host and configuration boundaries', () => {
  it.each(['https://example.test/path', 'https://user:password@example.test', 'https://example.test?q=1', 'https://*.example.test', 'javascript:alert(1)', 'null', 'http://example.test'])('rejects unsafe or ambiguous origin %s', (origin) => expect(normalizeBookingOrigin(origin)).toBeNull());
  it('normalizes exact origins and permits localhost only explicitly', () => {
    expect(normalizeBookingOrigin('https://EXAMPLE.test:443/')).toBe('https://example.test');
    expect(normalizeBookingOrigin('http://localhost:5173')).toBeNull();
    expect(normalizeBookingOrigin('http://localhost:5173', true)).toBe('http://localhost:5173');
  });
  it('keeps binding and origin lists out of the public presentation', () => {
    const presentation = bookingPresentation(parseBookingIntegration(row));
    expect(presentation).not.toHaveProperty('businessId');
    expect(presentation).not.toHaveProperty('allowedOrigins');
    expect(presentation).not.toHaveProperty('professionalIds');
    expect(presentation.videoInstructions).toBeNull();
  });
  it.each([{ contract_version: 2 }, { theme: 'arbitrary-css' }, { allowed_modalities: ['unknown'] }, { allowed_origins: ['https://example.test/path'] }, { revision: 0 }])('fails closed on unsupported configuration %j', (override) => expect(() => parseBookingIntegration({ ...row, ...override })).toThrow());
  it('rejects inactive integrations, unassigned choices and altered modalities', () => {
    const integration = parseBookingIntegration(row);
    expect(() => assertIntegrationSelection(integration, { serviceId, professionalIds: [professionalId], modality: 'video' })).not.toThrow();
    expect(() => assertIntegrationSelection(integration, { serviceId: businessId, professionalIds: [professionalId], modality: 'video' })).toThrow('SCOPE');
    expect(() => assertIntegrationSelection(integration, { serviceId, professionalIds: [businessId], modality: 'video' })).toThrow('SCOPE');
    expect(() => assertIntegrationSelection(integration, { serviceId, professionalIds: [professionalId], modality: 'unknown' })).toThrow('MODALITY');
    expect(() => assertIntegrationSelection({ ...integration, isActive: false }, { serviceId, professionalIds: [professionalId], modality: 'video' })).toThrow('UNAVAILABLE');
  });
  it('requires protocol, supported version, frame identity and bounded dimensions', () => {
    const message = { protocol: 'cita-suite.booking', version: 1, instanceId: 'abc', type: 'resize', height: 450 };
    expect(isBookingHostMessage(message, 'abc')).toBe(true);
    expect(isBookingHostMessage({ ...message, version: 2 }, 'abc')).toBe(false);
    expect(isBookingHostMessage(message, 'other')).toBe(false);
    expect(isBookingHostMessage({ ...message, height: Infinity }, 'abc')).toBe(false);
    expect(isBookingHostMessage({ ...message, type: 'request', requestId: 'guessed' }, 'abc')).toBe(false);
  });
});

describe('clinical intake contracts', () => {
  const fields = parseBookingIntakeFields(schema);
  it('preserves explicit false and does not invent an unanswered boolean', () => {
    expect(validateBookingIntakeAnswers(fields, { insurance: ' Particular ', labs: false })).toEqual({ insurance: 'Particular', labs: false });
    expect(validateBookingIntakeAnswers(fields, { insurance: 'Particular' })).not.toHaveProperty('labs');
  });
  it.each([{ insurance: '' }, { insurance: 'Particular', labs: 'false' }, { insurance: 'Particular', undeclared: 'secret' }, { insurance: 'x'.repeat(121) }])('rejects incomplete or malformed answers %j', (answers) => expect(() => validateBookingIntakeAnswers(fields, answers)).toThrow());
  it.each([{ ...schema[0], kind: 'html' }, { ...schema[0], id: 'constructor' }, { ...schema[0], maxLength: 50000 }, { ...schema[0], required: 'true' }])('rejects executable or unsupported form definitions %j', (field) => expect(() => parseBookingIntakeFields([field])).toThrow());
  it('rejects duplicate fields and invalid options', () => {
    expect(() => parseBookingIntakeFields([schema[0], schema[0]])).toThrow();
    expect(() => parseBookingIntakeFields([{ id: 'choice', label: 'Opción', kind: 'choice', required: false, options: ['same', 'same'] }])).toThrow();
  });
  it('bounds UTF-8 bytes as well as individual character counts', () => {
    const many = parseBookingIntakeFields(Array.from({ length: 10 }, (_, i) => ({ id: 'field_' + i, label: 'Respuesta', kind: 'text', required: false, maxLength: 2000 })));
    expect(() => validateBookingIntakeAnswers(many, Object.fromEntries(many.map((field) => [field.id, 'é'.repeat(1000)])))).toThrow('TOO_LONG');
  });
  it('decodes browser booleans and refuses duplicate or undeclared fields', () => {
    const integration = parseBookingIntegration(row);
    const form = new FormData(); form.set('intake_insurance', 'Particular'); form.set('intake_labs', 'false');
    expect(intakeAnswersFromForm(integration, form).labs).toBe(false);
    form.append('intake_labs', 'true'); expect(() => intakeAnswersFromForm(integration, form)).toThrow();
    form.delete('intake_labs'); form.set('intake_fake', 'x'); expect(() => intakeAnswersFromForm(integration, form)).toThrow();
  });
  it('returns human next actions without echoing a database failure', () => {
    expect(integratedBookingErrorMessage(new Error('BOOKING_AVAILABILITY_CHANGED'))).toContain('elegir');
    expect(integratedBookingErrorMessage(new Error('postgres secret failure'))).toBeNull();
  });
});

describe('bounded submissions and common atomic creator', () => {
  it('reads ordinary browser forms and rejects duplicate scalars', async () => {
    const request = (body: URLSearchParams) => new Request('https://example.test', { method: 'POST', body });
    expect((await readBoundedBookingForm(request(new URLSearchParams({ patient_name: 'Ana Prueba' })))).get('patient_name')).toBe('Ana Prueba');
    await expect(readBoundedBookingForm(request(new URLSearchParams([['patient_name', 'Ana'], ['patient_name', 'Otra']])))).rejects.toThrow('FORM_INVALID');
  });
  it('refuses oversized bodies and uploaded files before writing anything', async () => {
    await expect(readBoundedBookingForm(new Request('https://example.test', { method: 'POST', body: new URLSearchParams({ note: 'x'.repeat(70000) }) }))).rejects.toThrow('FORM_INVALID');
    const form = new FormData(); form.set('note', new Blob(['file']), 'private.txt');
    await expect(readBoundedBookingForm(new Request('https://example.test', { method: 'POST', body: form }))).rejects.toThrow('FORM_INVALID');
  });
  it('keeps the legacy RPC for existing callers and attaches integration through one atomic RPC', async () => {
    const rpc = vi.fn((_name: string, _args: Record<string, unknown>) => ({ single: async () => ({ data: { id: 'saved' }, error: null }) }));
    const input = { businessId, serviceId, professionalId, patient: { mode: 'public' as const, name: 'Ana Prueba', phone: '342 504 8209' }, startsAt: new Date('2026-11-01T12:00:00Z'), source: 'public_booking' as const, idempotencyKey: requestId };
    await createManualAppointment({ rpc } as any, input);
    expect(rpc.mock.calls[0][0]).toBe('create_appointment_with_patient_identity');
    rpc.mockClear();
    await createManualAppointment({ rpc } as any, { ...input, bookingIntegration: { integrationId, integrationRevision: 2, expectedAvailabilityRevision: 3, modality: 'video', intakeAnswers: { insurance: 'Particular' }, entryPoint: 'public_page' } });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('create_integrated_public_appointment');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_integration_id: integrationId, p_expected_availability_revision: 3, p_entry_point: 'public_page', p_modality: 'video' });
  });
});

describe('modality overlays use the existing availability engine', () => {
  const base = {
    business: { timezone: 'UTC', max_booking_days_ahead: 90, min_booking_notice_minutes: 0, is_active: true, public_booking_enabled: true },
    service: { id: serviceId, business_id: businessId, name: 'Consulta', duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, is_public: true, is_active: true },
    professionals: [{ id: professionalId, name: 'Profesional', is_public: true, is_active: true }],
    rules: [{ id: 'rule', professional_id: professionalId, weekday: 1, start_time: '09:00', end_time: '17:00', slot_interval_minutes: 30, break_minutes: 0, is_active: true }],
    exceptions: [], blocks: [], fromDate: '2026-11-02', toDate: '2026-11-02', publicOnly: true, now: new Date('2026-11-01T00:00:00Z')
  };
  it('finds the first virtual slot inside its window before applying per-day limits', () => {
    const windows = parseBookingModalityWindows([{ modality: 'video', weekday: 1, startTime: '11:00', endTime: '13:00' }]);
    const slots = calculateAvailabilitySlots({ ...base, modality: 'video', modalityWindows: windows, maxSlotsPerDate: 1 });
    expect(slots.map((slot) => slot.time)).toEqual(['11:00']);
    expect(calculateAvailabilitySlots({ ...base, modality: 'in_person', modalityWindows: windows })[0].time).toBe('09:00');
  });
  it('preserves global blocking across modalities and clips extra availability', () => {
    const windows = parseBookingModalityWindows([{ modality: 'video', weekday: 1, startTime: '11:00', endTime: '13:00' }]);
    const slots = calculateAvailabilitySlots({ ...base, modality: 'video', modalityWindows: windows, blocks: [{ id: 'busy', professional_id: professionalId, blocking_starts_at: '2026-11-02T11:00:00Z', blocking_ends_at: '2026-11-02T12:00:00Z' }], exceptions: [{ id: 'extra', professional_id: professionalId, starts_at: '2026-11-02T07:00:00Z', ends_at: '2026-11-02T09:00:00Z', type: 'extra_available' }] });
    expect(slots[0].time).toBe('12:00');
    expect(slots.every((slot) => slot.time >= '11:00' && slot.time < '13:00')).toBe(true);
  });
  it('restricts the original scheduling grid without inventing a shifted grid', () => {
    const windows = parseBookingModalityWindows([{ modality: 'video', weekday: 1, startTime: '11:07', endTime: '13:00' }]);
    const slots = calculateAvailabilitySlots({ ...base, modality: 'video', modalityWindows: windows });
    expect(slots[0].time).toBe('11:30');
    expect(slots.every((slot) => ['00', '30'].includes(slot.time.slice(3)))).toBe(true);
  });
  it('refuses impossible window definitions and supports professional-scoped restrictions', () => {
    expect(() => parseBookingModalityWindows([{ modality: 'video', weekday: 8, startTime: '09:00', endTime: '10:00' }])).toThrow();
    expect(() => parseBookingModalityWindows([{ modality: 'video', weekday: 1, startTime: '25:00', endTime: '26:00' }])).toThrow();
    const windows = parseBookingModalityWindows([{ modality: 'video', professionalId: businessId, weekday: 1, startTime: '11:00', endTime: '13:00' }]);
    expect(calculateAvailabilitySlots({ ...base, modality: 'video', modalityWindows: windows })[0].time).toBe('09:00');
  });
});

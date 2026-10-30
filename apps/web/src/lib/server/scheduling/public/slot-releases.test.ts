import { beforeEach, expect, it, vi } from 'vitest';
import { loadAppointmentSlotReleases, hideAppointmentSlotRelease, slotReleaseErrorMessage } from './slot-releases';
const rpc = vi.fn();
const client = { rpc } as never;
beforeEach(() => rpc.mockReset());
const row = (i: number) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, appointment_id: '00000000-0000-4000-8000-000000000002',
 professional_id: '00000000-0000-4000-8000-000000000003', service_id: '00000000-0000-4000-8000-000000000004', professional_name: 'Profesional',
 starts_at: '2026-11-03T12:00:00Z', ends_at: '2026-11-03T13:00:00Z', released_at: '2026-10-30T12:00:00Z', reason: 'rescheduled' });
it('lee una ventana y página en una llamada, reservando una fila centinela', async () => {
 rpc.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => row(i)), error: null });
 const list = await loadAppointmentSlotReleases(client, 'practice', { days: 14, page: 2, offset: 50 });
 expect(list.items).toHaveLength(50);expect(list.truncated).toBe(true);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('get_appointment_slot_releases', { p_business_id: 'practice', p_days: 14, p_limit: 51, p_offset: 50 });
});
it('una lectura fallida o nula no es una lista vacía', async () => {
 for (const result of [{ data: null, error: new Error('read failed') }, { data: null, error: null }]) {
  rpc.mockResolvedValue(result);await expect(loadAppointmentSlotReleases(client, 'practice', { days: 14, page: 1, offset: 0 })).rejects.toThrow();
 }
});
it('ocultar comprueba el resultado, acepta idempotencia y traduce errores sin códigos técnicos', async () => {
 for (const data of [true, false]) {
  rpc.mockResolvedValue({ data, error: null });await expect(hideAppointmentSlotRelease(client, 'practice', row(1).id)).resolves.toBe(data);
 }
 rpc.mockResolvedValue({ data: null, error: null });await expect(hideAppointmentSlotRelease(client, 'practice', row(1).id)).rejects.toThrow();
 for (const code of ['SLOT_RELEASE_FORBIDDEN', 'SLOT_RELEASE_NOT_FOUND', 'unrecognized']) {
  expect(slotReleaseErrorMessage(new Error(code))).not.toMatch(/SLOT_RELEASE|SQL|RPC|HTTP|unrecognized/);
 }
});

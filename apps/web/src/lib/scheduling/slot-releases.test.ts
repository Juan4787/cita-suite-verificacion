import { describe, expect, it } from 'vitest';
import { parseSlotReleaseRows, slotReleaseHref, slotReleaseWindow, SLOT_RELEASE_REASONS } from './slot-releases';

const id = '00000000-0000-4000-8000-000000000001';
const row = () => ({ id, appointment_id: '00000000-0000-4000-8000-000000000002',
 professional_id: '00000000-0000-4000-8000-000000000003', service_id: '00000000-0000-4000-8000-000000000004',
 professional_name: 'Profesional de nombre compuesto y extenso', starts_at: '2026-11-03T00:30:00.000Z',
 ends_at: '2026-11-03T01:30:00.000Z', released_at: '2026-10-30T12:00:00.000Z', reason: 'rescheduled' });

describe('horarios liberados: contrato y vista', () => {
 it('conserva el horario y arma la reasignación en el día local, incluso al cruzar medianoche UTC', () => {
  const [release] = parseSlotReleaseRows([row()]);
  const url = new URL(slotReleaseHref(release, 'America/Argentina/Cordoba'), 'https://app.test');
  expect(url.pathname).toBe('/odonto/agenda');
  expect(Object.fromEntries(url.searchParams)).toEqual({ date: '2026-11-02', professional_id: row().professional_id, service_id: row().service_id, hora: '21:30' });
  expect(SLOT_RELEASE_REASONS[release.reason]).toBe('Se reprogramó');
  expect(release.professionalName).toBe(row().professional_name);
 });
 it('no convierte una respuesta inválida, duplicada o demasiado grande en una lista vacía', () => {
  for (const rows of [null, {}, [row(), row()], [{ ...row(), id: 'otro' }], [{ ...row(), reason: 'unknown' }],
   [{ ...row(), starts_at: 'fecha inválida' }], [{ ...row(), ends_at: row().starts_at }], [{ ...row(), released_at: '' }]]) {
   expect(() => parseSlotReleaseRows(rows)).toThrow();
  }
  expect(() => parseSlotReleaseRows(Array.from({ length: 52 }, (_, i) => ({ ...row(), id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })))).toThrow();
  expect(parseSlotReleaseRows([])).toEqual([]);
 });
 it('mantiene la ventana y paginación acotadas, con 14 días por defecto', () => {
  expect(slotReleaseWindow(new URLSearchParams())).toEqual({ days: 14, page: 1, offset: 0 });
  expect(slotReleaseWindow(new URLSearchParams('dias_liberados=30&pagina_liberados=2'))).toEqual({ days: 30, page: 2, offset: 50 });
  expect(slotReleaseWindow(new URLSearchParams('dias_liberados=60&pagina_liberados=1001'))).toEqual({ days: 60, page: 1001, offset: 50000 });
  for (const value of ['0', '-1', '61', '1.5', 'NaN', '100000000']) {
   expect(slotReleaseWindow(new URLSearchParams(`dias_liberados=${value}&pagina_liberados=${value==='61'?'1002':value}`))).toMatchObject({ days: 14, page: 1 });
  }
 });
});

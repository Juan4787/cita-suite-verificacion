import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import SlotReleaseAlerts from './SlotReleaseAlerts.svelte';
afterEach(cleanup);
const release = { id: '00000000-0000-4000-8000-000000000001', appointmentId: '00000000-0000-4000-8000-000000000002',
 professionalId: '00000000-0000-4000-8000-000000000003', serviceId: '00000000-0000-4000-8000-000000000004',
 professionalName: 'Profesional con nombre extenso', startsAt: '2026-11-03T12:00:00Z', endsAt: '2026-11-03T13:00:00Z',
 releasedAt: '2026-10-30T12:00:00Z', reason: 'deposit_expired' as const };
const props = () => ({ list: { items: [release], days: 14, page: 2, truncated: true }, timezone: 'America/Argentina/Cordoba', canOperate: true, demo: false,
 query: '?date=2026-11-03&status=reserved&dias_liberados=14&pagina_liberados=2' });
it('ofrece reasignar y ocultar con el ID observado, conservando los filtros y avisando si hay más', () => {
 render(SlotReleaseAlerts, props());
 expect(screen.getByText('Venció la seña')).toBeVisible();
 const href = new URL(screen.getByRole('link', { name: 'Dar este horario' }).getAttribute('href')!, 'https://app.test');
 expect(Object.fromEntries(href.searchParams)).toMatchObject({ date: '2026-11-03', hora: '09:00', professional_id: release.professionalId });
 const form = screen.getByRole('button', { name: 'Ocultar' }).closest('form')!;
 expect(form.querySelector<HTMLInputElement>('[name="release_id"]')!.value).toBe(release.id);
 const action = new URL(form.getAttribute('action')!, 'https://app.test/odonto/agenda');
 expect(action.searchParams.get('status')).toBe('reserved');
 expect(action.searchParams.has('/hide_slot_release')).toBe(true);
 const next = new URL(screen.getByRole('link', { name: 'Más horarios' }).getAttribute('href')!, 'https://app.test');
 expect(next.searchParams.get('pagina_liberados')).toBe('3');expect(next.searchParams.get('status')).toBe('reserved');
 expect(screen.getByLabelText('Ver próximos días')).toHaveValue('14');
});
it('una lectura desconocida se explica y no se presenta como una lista vacía', () => {
 render(SlotReleaseAlerts, { ...props(), list: { ...props().list, items: null } });
 expect(screen.getByRole('alert')).toHaveTextContent('No pudimos comprobar los horarios liberados');
 expect(screen.queryByText(/No hay horarios/)).not.toBeInTheDocument();
});
it('al alcanzar la ventana máxima no ofrece una página inválida que vuelva al principio', () => {
 render(SlotReleaseAlerts, { ...props(), list: { ...props().list, page: 1001 } });
 expect(screen.queryByRole('link', { name: 'Más horarios' })).not.toBeInTheDocument();
 expect(screen.getByText(/Elegí un rango más corto/)).toBeVisible();
});
it('sólo lectura y demo no ofrecen escrituras ni enlaces reales de reasignación en demo', () => {
 const first = render(SlotReleaseAlerts, { ...props(), canOperate: false });
 expect(screen.queryByRole('button', { name: 'Ocultar' })).not.toBeInTheDocument();
 expect(screen.queryByRole('link', { name: 'Dar este horario' })).not.toBeInTheDocument();
 first.unmount();
 render(SlotReleaseAlerts, { ...props(), demo: true });
 expect(screen.getByRole('button', { name: 'Dar este horario' })).toBeDisabled();
 expect(screen.getByRole('button', { name: 'Ocultar' })).toBeDisabled();
 expect(screen.queryByRole('link', { name: 'Dar este horario' })).not.toBeInTheDocument();
});

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Panel from './PatientManagementPanel.svelte';
import type { PatientManagementPanelData } from '$lib/scheduling/patient-management-page';
import type { ComponentProps } from 'svelte';
import { tick } from 'svelte';
import type { SubmitFunction } from '@sveltejs/kit';
const renderPanel = (props: ComponentProps<typeof Panel>) => render(Panel, { props });
const enhancement = vi.hoisted(() => ({ submitters: new Map<HTMLFormElement, SubmitFunction>() }));
vi.mock('$app/forms', () => ({ enhance: (node: HTMLFormElement, submit: SubmitFunction) => {
 enhancement.submitters.set(node, submit); return { destroy() { enhancement.submitters.delete(node); } };
} }));
afterEach(cleanup);
const context = (overrides: Partial<PatientManagementPanelData> = {}): PatientManagementPanelData => ({
 url: '/gestion/personal-token', revision: 'observed-revision', operationId: 'original-operation', mode: 'overview',
 startsAt: '2026-12-01T12:00:00Z', timezone: 'America/Argentina/Cordoba', now: '2026-11-03T14:00:00Z',
 canCancel: true, canReschedule: true, canConfirm: true, date: '2026-12-02', slots: [], selectedStart: null,
 availabilityRevision: 9, integrationRevision: null, durationMinutes: 45, financialTerms: null, unavailableMessage: null,
 financialSummary: { appliedAmount: '0', forfeitedAmount: '0', unresolvedAmount: '0' }, ...overrides
});
describe('contextual patient management panel', () => {
 it('offers both independent available paths from a current appointment', () => {
  renderPanel({ context: context() });
  expect(screen.getByRole('link', { name: 'Cancelar turno' })).toHaveAttribute('href', '/gestion/personal-token?accion=cancelar');
  expect(screen.getByRole('link', { name: 'Reprogramar turno' })).toHaveAttribute('href', '/gestion/personal-token?accion=reprogramar');
 });
 it('asks cancellation explicitly, preserves the observed operation and offers the other allowed path', () => {
  const { container } = renderPanel({ context: context({ mode: 'cancel' }) });
  expect(screen.getByRole('heading', { name: '¿Querés cancelar este turno?' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sí, cancelar turno' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Prefiero reprogramar' })).toBeVisible();
  expect(container.querySelector('input[name="expected_revision"]')).toHaveValue('observed-revision');
  expect(container.querySelector('input[name="operation_id"]')).toHaveValue('original-operation');
 });
 it('shows no cancel/reschedule action for a cancelled/past appointment even with a stale query mode', () => {
  renderPanel({ context: context({ mode: 'cancel', canCancel: false, canReschedule: false, canConfirm: false,
   financialSummary: { appliedAmount: '0', forfeitedAmount: '0', unresolvedAmount: '40000' } }) });
  expect(screen.queryByRole('button', { name: /cancelar|reprogramar/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /cancelar|reprogramar/i })).not.toBeInTheDocument();
  expect(screen.getByText(/dinero.*resolver/i)).toBeVisible();
 });
 it('offers the cancellation alternative on the selection screen, with no mutation button before a choice', () => {
  renderPanel({ context: context({ mode: 'reschedule' }) });
  expect(screen.getByRole('heading', { name: '¿Querés reprogramar este turno?' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Prefiero cancelar sin reprogramar' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Confirmar reprogramación' })).not.toBeInTheDocument();
 });
 it('removes the old date slots and accepted summary while a different date has not been consulted', async () => {
  renderPanel({ context: context({ mode: 'reschedule', selectedStart: '2026-12-02T12:00:00Z',
   slots: [{ starts_at: '2026-12-02T12:00:00Z', ends_at: '2026-12-02T12:45:00Z' }],
   financialTerms: { kind: 'none', unavailable_reason: null, required: false, amount: null, base_amount: null, currency: 'ARS',
    previous_applicable_payment_amount: '0', previous_payment_disposition: 'none', forfeit_amount: '0', credit_amount: '0',
    quote_amount: null, quote_remainder: null, request_from: null, due_at: null, auto_cancel: false, last_minute: false,
    terms_informed: false, current_deposit_status: null, current_deposit_amount: null, current_payment_allocation: null,
    request_days: null, deadline_hours: null, min_payment_hours: null }
  }) });
  expect(screen.getByRole('button', { name: 'Confirmar reprogramación' })).toBeVisible();
  expect(screen.getByLabelText('Horarios disponibles')).toBeVisible();
  await fireEvent.input(document.querySelector('[name="fecha"]')!, { target: { value: '2026-12-03' } });
  expect(screen.queryByLabelText('Horarios disponibles')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirmar reprogramación' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Consultá los horarios de la fecha elegida.');
  expect(screen.getByRole('link', { name: 'Conservar mi turno' })).toBeVisible();
 });
 it('does not offer a hidden/denied alternative and keeps the no-change exit', () => {
  renderPanel({ context: context({ mode: 'cancel', canReschedule: false }) });
  expect(screen.queryByRole('link', { name: 'Prefiero reprogramar' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Conservar mi turno' })).toHaveAttribute('href', '/gestion/personal-token');
 });
 it('does not claim an unverified transport failure rolled back; retries only the original submitted operation', () => {
  const { container } = renderPanel({ context: context(), feedback: { message: 'No pudimos comprobar el resultado.', action: 'reschedule', retrySameOperation: true,
   submitted: { operation_id: 'lost-operation', expected_revision: 'old-revision', starts_at: '2026-12-02T12:00:00Z' } } });
  expect(screen.getByRole('button', { name: 'Reintentar la misma acción' })).toBeVisible();
  expect(container.querySelector('input[name="operation_id"]')).toHaveValue('lost-operation');
  expect(container.querySelector('input[name="expected_revision"]')).toHaveValue('old-revision');
  expect(screen.queryByRole('link', { name: 'Cancelar turno' })).not.toBeInTheDocument();
 });
 it('keeps the original request on a browser-side network error before a server response can arrive', async () => {
  const { container } = renderPanel({ context: context({ mode: 'cancel' }) });
  const button = screen.getByRole('button', { name: 'Sí, cancelar turno' });
  const form = button.closest('form')!; const action = new URL(form.action); const formData = new FormData(form);
  const submit = enhancement.submitters.get(form)!;
  const complete = await submit({ action, formData, formElement: form, controller: new AbortController(), cancel: vi.fn(), submitter: button });
  if (!complete) throw new Error('Expected progressive form continuation');
  const update = vi.fn();
  await complete({ action, formData, formElement: form, update, result: { type: 'error', status: 500, error: new Error('network unavailable') } });
  await tick();
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Reintentar la misma acción' })).toBeVisible();
  expect(container.querySelector('input[name="operation_id"]')).toHaveValue('original-operation');
  expect(container.querySelector('input[name="expected_revision"]')).toHaveValue('observed-revision');
  expect(screen.getByRole('alert')).not.toHaveTextContent(/network unavailable|no se guardó/i);
  expect(screen.getByRole('alert')).toHaveFocus();
 });
 it('P5: dentro de la ventana de autogestión oculta Cancelar y Reprogramar, mantiene Confirmar y muestra el aviso con WhatsApp', () => {
  renderPanel({
   context: context({
    canCancel: false,
    canReschedule: false,
    canConfirm: true,
    selfManagementCutoffHours: 48,
    selfManagementCutoffAt: '2026-11-29T12:00:00Z',
    selfManagementWindowClosed: true,
    practiceWhatsApp: {
     whatsappUrl: 'https://wa.me/5493415550123?text=Hola',
     whatsappWebUrl: 'https://web.whatsapp.com/send?phone=5493415550123&text=Hola'
    }
   })
  });
  expect(screen.getByRole('button', { name: 'Confirmo que voy' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Cancelar turno' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Reprogramar turno' })).not.toBeInTheDocument();
  expect(screen.getByText(/48\s*horas antes/i)).toBeVisible();
  expect(screen.getByRole('link', { name: /WhatsApp/i })).toHaveAttribute('href', expect.stringMatching(/wa\.me|web\.whatsapp\.com/));
 });
 it('P5: al elegir un nuevo horario dentro de la ventana de autogestión avisa antes de confirmar que ya no podrá cambiarse online', () => {
  renderPanel({
   context: context({
    mode: 'reschedule',
    now: '2026-12-01T14:00:00Z',
    selectedStart: '2026-12-02T12:00:00Z',
    selfManagementCutoffHours: 48,
    slots: [{ starts_at: '2026-12-02T12:00:00Z', ends_at: '2026-12-02T12:45:00Z' }],
    financialTerms: {
     kind: 'none', unavailable_reason: null, required: false, amount: null, base_amount: null, currency: 'ARS',
     previous_applicable_payment_amount: '0', previous_payment_disposition: 'none', forfeit_amount: '0', credit_amount: '0',
     quote_amount: null, quote_remainder: null, request_from: null, due_at: null, auto_cancel: false, last_minute: false,
     terms_informed: false, current_deposit_status: null, current_deposit_amount: null, current_payment_allocation: null,
     request_days: null, deadline_hours: null, min_payment_hours: null
    }
   })
  });
  expect(screen.getByText(/ya no se podrá cancelar ni reprogramar online/i)).toBeVisible();
 });
});

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { appointment, data, type PageData } from './page-fixture';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('cancelling from the detail', () => {
 const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
 const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
 const at = (start: Date) => ({ ...appointment,starts_at: start.toISOString(),ends_at: new Date(start.getTime() + 30 * 60 * 1000).toISOString() });
 const reception: PageData = { ...data,justCreated: false,context: { canOperate: true,role: 'reception' },appointment: at(future) };
 const paid: NonNullable<PageData['deposit']> = { appointment_id: appointment.id,status: 'paid',amount: 40000,currency: 'ARS',
  request_from: '2026-08-13T00:00:00Z',due_at: '2026-08-18T15:00:00Z',auto_cancel: false,waived_reason: null,
  recorded_at: '2026-08-14T12:00:00Z',reminder_opened_at: null,expired_at: null,revision: 2,cancelsItself: false };
 it('offers reception a confirmation that says what happens to the slot, the money and the patient', () => {
  const { container } = render(Page,{ data: { ...reception,deposit: paid } });
  const panel = container.querySelector<HTMLDetailsElement>('[data-cancel-panel]')!;
  panel.open = true;
  expect(panel).toHaveTextContent('Vas a cancelar el turno de Paciente de prueba');
  expect(panel).toHaveTextContent('El horario queda libre para otra reserva.');
  expect(panel).toHaveTextContent('La seña de $ 40.000 queda por resolver con el paciente. Cancelar no registra una devolución.');
  expect(panel).toHaveTextContent('El paciente no tiene correo cargado: avisale por otro medio.');
  const form = panel.querySelector<HTMLFormElement>('form[action="?/update_status"]')!;
  expect(new FormData(form).get('status')).toBe('cancelled');
  expect(new FormData(form).get('operation_id')).toBe(data.management!.statusOperationId);
  expect(screen.getByRole('checkbox',{ name: 'Confirmo que quiero cancelar este turno.' })).toBeRequired();
  expect(container.querySelector('[data-started-notice]')).not.toBeInTheDocument();
 });
 it('says that a past appointment passed and why it has no cancellation, instead of hiding it in silence', () => {
  const { container } = render(Page,{ data: { ...reception,appointment: at(past) } });
  expect(container.querySelector('[data-cancel-panel]')).not.toBeInTheDocument();
  expect(container.querySelector('form[action="?/update_status"]')).not.toBeInTheDocument();
  expect(container.querySelector('[data-started-badge]')).toHaveTextContent('Turno pasado');
  expect(container.querySelector('[data-started-notice]')).toHaveTextContent('Este turno ya pasó. Por eso no se puede cancelar. Si el paciente necesita otro horario, podés reprogramarlo.');
 });
 it('tells an appointment in progress apart from one that is over', () => {
  const { container } = render(Page,{ data: { ...reception,appointment: at(new Date(Date.now() - 5 * 60 * 1000)) } });
  expect(container.querySelector('[data-started-badge]')).toHaveTextContent('En curso');
  expect(container.querySelector('[data-started-notice]')).toHaveTextContent('Este turno ya empezó. Por eso no se puede cancelar.');
 });
 it('shows neither the form nor the instructions to a role that cannot operate', () => {
  for (const role of ['professional','readonly']) {
   const { container,unmount } = render(Page,{ data: { ...reception,context: { canOperate: false,role },appointment: at(future) } });
   expect(container.querySelector('[data-cancel-panel]')).not.toBeInTheDocument();
   unmount();
   const pastView = render(Page,{ data: { ...reception,context: { canOperate: false,role },appointment: at(past) } });
   expect(pastView.container.querySelector('[data-started-notice]')).toHaveTextContent('Este turno ya pasó.');
   expect(pastView.container.querySelector('[data-started-notice]')).not.toHaveTextContent('cancelar');
   pastView.unmount();
  }
 });
 it('never marks a cancelled appointment as past', () => {
  const { container } = render(Page,{ data: { ...reception,appointment: { ...at(past),status: 'cancelled' } } });
  expect(container.querySelector('[data-started-badge]')).not.toBeInTheDocument();
  expect(container.querySelector('[data-started-notice]')).not.toBeInTheDocument();
 });
});

describe('money after cancellation', () => {
 const deposit: NonNullable<PageData['deposit']> = { appointment_id: appointment.id,status: 'expired',amount: 40000,currency: 'ARS',
  request_from: '2026-08-13T00:00:00Z',due_at: '2026-08-18T15:00:00Z',auto_cancel: true,waived_reason: null,
  recorded_at: null,reminder_opened_at: null,expired_at: '2026-08-18T15:00:00Z',revision: 2,cancelsItself: true };
 const cancelled: PageData = { ...data,justCreated: false,appointment: { ...appointment,status: 'cancelled' },deposit };
 it('uses a distinct reviewed operation and explicit confirmation, without the ordinary paid/waived controls', () => {
  const { container } = render(Page,{ data: cancelled });
  container.querySelector<HTMLDetailsElement>('#late-deposit-record')!.open = true;
  const form = container.querySelector<HTMLFormElement>('form[action="?/late_deposit"]')!;
  expect(new FormData(form).get('operation_id')).toBe(data.management!.lateDepositOperationId);
  expect(new FormData(form).get('expected_revision')).toBe(data.management!.revision);
  expect(new FormData(form).get('late_action')).toBe('record');
  expect(screen.getByLabelText('Importe recibido, en pesos')).toHaveAttribute('inputmode','numeric');
  const checkbox = screen.getByRole('checkbox',{ name: 'Verifiqué el ingreso y que corresponde a este paciente' });
  expect(checkbox).not.toBeChecked(); expect(checkbox).toBeRequired();
  expect(screen.queryByRole('button',{ name: 'Confirmar seña' })).not.toBeInTheDocument();
  expect(screen.getByText('El turno sigue cancelado. El importe queda registrado por resolver.')).toBeInTheDocument();
 });
 it('preserves an editable rejected draft and hides monetary forms from readonly', async () => {
  const { rerender } = render(Page,{ data: cancelled,form: { message: 'Revisá el importe',lateDepositDraft: { amount: '1,5',note: 'Conservar esta nota' } } });
  expect(screen.getByLabelText('Importe recibido, en pesos')).toHaveValue('1,5');
  expect(screen.getByLabelText('Nota del registro (opcional)')).toHaveValue('Conservar esta nota');
  await rerender({ data: { ...cancelled,canRecordDeposit: false,context: { ...data.context,role: 'readonly' } } });
  expect(screen.queryByRole('button',{ name: 'Registrar dinero' })).not.toBeInTheDocument();
 });
 it('correction names the original fact, keeps the exact request, and cannot become a status action', () => {
  const fields = { operation_id: 'original-correction',expected_revision: 'original-revision',late_action: 'correct',amount: '',corrects_event_id: 'original-event',note: '',confirm_late_deposit: 'true' };
  const { container } = render(Page,{ data: cancelled,form: { message: 'Comprobar el resultado',retry: { action: 'late_deposit',fields } } });
  const retry = screen.getByRole('button',{ name: 'Reintentar la misma acción' }).closest('form')!;
  expect(retry).toHaveAttribute('action','?/late_deposit');
  expect(Object.fromEntries(new FormData(retry))).toEqual(fields);
  expect(container.querySelector('form[action="?/update_status"]')).toBeNull();
  expect(container.querySelector('#late-deposit-record button')).toBeDisabled();
 });
});

describe('appointment email', () => {
 const delivery = (state: NonNullable<PageData['emailDeliveries']>[number]['state'], extra: Partial<NonNullable<PageData['emailDeliveries']>[number]> = {}) => ({
  id: `delivery-${state}`, purpose: 'booking_receipt' as const, state, recipient: 'paciente@example.test',
  createdAt: '2026-08-05T12:00:00.000Z', acceptedAt: null, deliveredAt: null, discardReason: null, ...extra
 });
 it('names what the provider proved, never that the patient read it', () => {
  render(Page, { data: { ...data, emailDeliveries: [delivery('accepted'), delivery('delivered', { purpose: 'reminder_24h' })] } });
  expect(screen.getByText('Aceptado por el proveedor · paciente@example.test')).toBeInTheDocument();
  expect(screen.getByText('Entregado al servidor del destinatario · paciente@example.test')).toBeInTheDocument();
  expect(screen.queryByText(/leído|abierto/i)).not.toBeInTheDocument();
 });
 it('lets staff decide an uncertain message knowing it may be duplicated', () => {
  const { container } = render(Page, { data: { ...data, emailDeliveries: [delivery('uncertain')] } });
  expect(screen.getByText('En comprobación · paciente@example.test')).toBeInTheDocument();
  expect(screen.getByText(/podría recibirlo dos veces/)).toBeInTheDocument();
  const forms = [...container.querySelectorAll<HTMLFormElement>('form[action="?/email_delivery"]')];
  expect(forms.map((form) => Object.fromEntries(new FormData(form)))).toEqual([
   { delivery_id: 'delivery-uncertain', decision: 'resend' },
   { delivery_id: 'delivery-uncertain', decision: 'dismiss' }
  ]);
  expect(screen.getByRole('button', { name: 'Reenviar igual' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Dejarlo así' })).toBeEnabled();
 });
 it('explains a discarded message and offers no decision to readonly staff', () => {
  const { container } = render(Page, { data: { ...data, context: { canOperate: false, role: 'readonly' },
   emailDeliveries: [delivery('discarded', { discardReason: 'superseded_schedule' }), delivery('uncertain', { id: 'other' })] } });
  expect(screen.getByText('No se envió: el horario cambió · paciente@example.test')).toBeInTheDocument();
  expect(container.querySelector('form[action="?/email_delivery"]')).toBeNull();
 });
 it('shows nothing when the list could not be read', () => {
  const { container } = render(Page, { data: { ...data, emailDeliveries: null } });
  expect(container.querySelector('[data-email-deliveries]')).toBeNull();
 });
});

describe('observed staff operation form', () => {
 it('keeps the observed revision and distinct operation identities on the two forms', () => {
  const { container } = render(Page, { data: { ...data, justCreated: false, appointment: { ...appointment, starts_at: new Date(Date.now()+86400000).toISOString() } } });
  const cancel = container.querySelector('form[action="?/update_status"]');
  expect(cancel?.querySelector('[name="expected_revision"]')).toHaveValue(data.management!.revision);
  expect(cancel?.querySelector('[name="operation_id"]')).toHaveValue(data.management!.statusOperationId);
  expect(cancel?.querySelector('[name="confirm_cancel"]')).toHaveAttribute('value', 'true');
 });
 it('retains the EXACT uncertain request even when the newly loaded appointment is already cancelled', async () => {
  const fields = { operation_id: 'original-operation', expected_revision: 'original-revision', status: 'cancelled', reason: 'Solicitado', confirm_cancel: 'true' };
  const { container } = render(Page, { data: { ...data, appointment: { ...appointment, status: 'cancelled' } },
   form: { success: false, message: 'Comprobar el resultado', retry: { action: 'update_status', fields } } });
  const button = screen.getByRole('button', { name: 'Reintentar la misma acción' });
  const retry = button.closest('form')!;
  expect(Object.fromEntries(new FormData(retry))).toEqual(fields);
  expect(container.querySelectorAll('form[action="?/update_status"]')).toHaveLength(1);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
 });
 it('binds the offered slots to the version and duration of that same calculation', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ slots: [{ date: '2026-08-20', time: '10:00', starts_at: '2026-08-20T13:00:00Z', professional_name: 'Profesional' }], availabilityRevision: 9, durationMinutes: 45 }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const { container } = render(Page, { data: { ...data, justCreated: false } });
  const panel = container.querySelector<HTMLDetailsElement>('#reprogramar')!;
  panel.open = true; await fireEvent(panel, new Event('toggle'));
  await waitFor(() => expect(screen.getByRole('button', { name: /^10:00$/ })).toBeInTheDocument());
  const url = new URL(fetch.mock.calls[0][0], 'https://app.test');
  expect(url.searchParams.get('expected_revision')).toBe(data.management!.revision);
  await fireEvent.click(screen.getByRole('button', { name: /^10:00$/ }));
  const form = container.querySelector('form[action="?/reschedule"]');
  expect(form?.querySelector('[name="availability_revision"]')).toHaveValue('9');
  expect(form?.querySelector('[name="operation_id"]')).toHaveValue(data.management!.rescheduleOperationId);
  expect(screen.getByText('Duración de la consulta: 45 minutos.')).toBeInTheDocument();
 });
});

describe('entrega explícita desde el detalle', () => {
 const preparedForm = (label: string) => screen.getByRole('button', { name: label }).closest('form')!;
 it('solicita el enlace en un POST nuevo con revisión y dispositivo; no expone credenciales al leer', () => {
  const { container } = render(Page, { data });
  const action = screen.getByRole('button', { name: 'Enviar enlace de activación' }), form = action.closest('form')!;
  expect(form).toHaveAttribute('method', 'POST'); expect(form).toHaveAttribute('target', '_blank');
  expect(form).toHaveAttribute('rel', 'noopener'); expect(form).toHaveAttribute('action', '?created=1&/prepare_delivery');
  expect(Object.fromEntries(new FormData(form))).toEqual({ kind: 'activation', destination: 'whatsapp', expected_revision: data.management!.revision, device: 'desktop' });
  expect(action.className).toContain('bg-success-500'); expect(action.className).toContain('min-h-[4.5rem]');
  expect(container.querySelector('a[href*="wa.me"],a[href*="whatsapp.com"],a[href*="/gestion/"],a[href*="/turno/"]')).toBeNull();
  expect(screen.getByText(/Revisá el mensaje y envialo/)).toBeInTheDocument();
 });
 it.each(['android','ios'] as const)('transporta %s para que el servidor abra la aplicación apropiada', activationDevice => {
  render(Page, { data: { ...data, activationDevice } });
  expect(new FormData(preparedForm('Enviar enlace de activación')).get('device')).toBe(activationDevice);
 });
 it('reconoce un iPad que se identifica como Mac antes de preparar el mensaje', async () => {
  vi.stubGlobal('navigator', { maxTouchPoints: 5, platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });
  render(Page, { data: { ...data, activationDevice: 'desktop' } });
  await waitFor(() => expect(new FormData(preparedForm('Enviar enlace de activación')).get('device')).toBe('ios'));
 });
 it('la actualización y la vista previa preparan enlaces por separado, sólo al solicitarlos', () => {
  render(Page, { data: { ...data, justCreated: false, justRescheduled: true } });
  const message = preparedForm('Enviar actualización por WhatsApp'), preview = preparedForm('Ver lo que verá el paciente');
  for (const form of [message, preview]) {
   expect(form).toHaveAttribute('method', 'POST'); expect(form).toHaveAttribute('target', '_blank');
   expect(new FormData(form).get('kind')).toBe('rescheduled');
   expect(new FormData(form).get('expected_revision')).toBe(data.management!.revision);
  }
  expect(new FormData(message).get('destination')).toBe('whatsapp');
  expect(new FormData(preview).get('destination')).toBe('preview');
 });
 it('sin teléfono ofrece corregir la ficha y conserva una vista previa útil del cambio', () => {
  const { unmount } = render(Page, { data: { ...data, delivery: { available: true, hasPhone: false } } });
  expect(screen.queryByRole('button', { name: 'Enviar enlace de activación' })).not.toBeInTheDocument();
  expect(screen.getByText('Falta completar el teléfono del paciente')).toBeInTheDocument(); unmount();
  render(Page, { data: { ...data, justCreated: false, justRescheduled: true, delivery: { available: true, hasPhone: false } } });
  expect(screen.queryByRole('button', { name: 'Enviar actualización por WhatsApp' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ver lo que verá el paciente' })).toBeInTheDocument();
 });
 it('no vuelve a advertir si el usuario ya decidió continuar sin teléfono', () => {
  render(Page, { data: { ...data, phoneWarningAcknowledged: true } });
  expect(screen.queryByRole('heading', { name: 'Último paso' })).not.toBeInTheDocument();
 });
 it('no ofrece preparar si el permiso o el contexto actual ya no lo permiten', () => {
  render(Page, { data: { ...data, justRescheduled: true, delivery: { available: false, hasPhone: true } } });
  expect(screen.queryByRole('heading', { name: 'Último paso' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enviar actualización por WhatsApp' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ver lo que verá el paciente' })).not.toBeInTheDocument();
 });
 it('no agrega la indicación de alta a una visita normal del detalle', () => {
  render(Page, { data: { ...data, justCreated: false } });
  expect(screen.queryByRole('heading', { name: 'Último paso' })).not.toBeInTheDocument();
 });
});

describe('turno cancelado', () => {
	it('no vuelve a ofrecer la cancelación desde el detalle interno', () => {
		render(Page, {
			data: {
				...data,
				appointment: {
					...appointment,
					status: 'cancelled'
				}
			}
		});

		expect(screen.getByText('Cancelado')).toBeInTheDocument();
		expect(screen.queryByText('Cancelar turno')).not.toBeInTheDocument();
	});
});

describe('visibilidad de cancelación por estado y fecha', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-22T15:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const renderAppointment = (overrides: Record<string, unknown> = {}) =>
		render(Page, {
			data: {
				...data,
				justCreated: false,
				appointment: {
					...appointment,
					starts_at: '2026-08-22T16:00:00.000Z',
					ends_at: '2026-08-22T16:30:00.000Z',
					...overrides
				}
			}
		});

	it.each(['reserved', 'confirmed', 'reschedule_requested'] as const)(
		'muestra cancelar para un turno %s activo y futuro',
		(status) => {
			renderAppointment({ status });

			expect(screen.getByText('Cancelar turno', { selector: 'summary' })).toBeInTheDocument();
		}
	);

	it('oculta cancelar cuando el turno ya comenzó, aunque siga reservado', () => {
		renderAppointment({
			starts_at: '2026-08-22T14:59:59.999Z',
			ends_at: '2026-08-22T15:30:00.000Z'
		});

		expect(screen.queryByText('Cancelar turno', { selector: 'summary' })).not.toBeInTheDocument();
	});
});

describe('seña del turno en el detalle', () => {
	const deposit = (overrides: Partial<NonNullable<PageData['deposit']>> = {}): NonNullable<PageData['deposit']> => ({
		appointment_id: 'appointment-1',
		status: 'pending',
		amount: 40000,
		currency: 'ARS',
		request_from: '2026-08-13T03:00:00.000Z',
		due_at: '2026-08-18T15:00:00.000Z',
		auto_cancel: true,
		waived_reason: null,
		recorded_at: null,
		reminder_opened_at: null,
		expired_at: null,
		revision: 3,
		cancelsItself: true,
		...overrides
	});
	const panel = () => document.querySelector('[data-deposit-panel]') as HTMLElement;
	const fieldsOf = (button: string) => Object.fromEntries(new FormData(screen.getByRole('button', { name: button }).closest('form')!));

	it('con la seña pendiente el estado lo dice y ofrece confirmarla o exceptuarla con la revisión que se vio', () => {
		render(Page, { data: { ...data, justCreated: false, deposit: deposit() } });
		expect(screen.getByText('Reservado, seña pendiente')).toBeInTheDocument();
		expect(panel()).toHaveTextContent('Seña pendiente');
		expect(panel()).toHaveTextContent('Si no se registra antes del vencimiento, el turno se cancela solo.');
		expect(fieldsOf('Confirmar seña')).toEqual({ deposit_action: 'paid', expected_revision: '3' });
		expect(fieldsOf('Sí, exceptuar la seña')).toEqual({ deposit_action: 'waived', expected_revision: '3' });
		expect(screen.queryByRole('button', { name: /deshacer/i })).toBeNull();
	});

	it('dice cuando no se cancela sola y cuando no se pudo comprobar', () => {
		render(Page, { data: { ...data, justCreated: false, deposit: deposit({ cancelsItself: false }) } });
		expect(panel()).toHaveTextContent('No se cancela sola: si no llega, decide el consultorio.');
		cleanup();
		render(Page, { data: { ...data, justCreated: false, deposit: deposit({ cancelsItself: null }) } });
		expect(panel()).toHaveTextContent('No pudimos comprobar si este turno se cancela solo.');
	});

	it('con la seña recibida el turno dice Confirmado, seña recibida, y se puede deshacer', () => {
		render(Page, {
			data: { ...data, justCreated: false, appointment: { ...appointment, status: 'confirmed' }, deposit: deposit({ status: 'paid', recorded_at: '2026-08-15T15:00:00.000Z' }) }
		});
		expect(screen.getByText('Confirmado, seña recibida')).toBeInTheDocument();
		expect(fieldsOf('Sí, deshacer el registro')).toEqual({ deposit_action: 'pending', expected_revision: '3' });
		expect(screen.queryByRole('button', { name: 'Confirmar seña' })).toBeNull();
	});

	it('una exención por política apagada, un turno cancelado o quien no registra señas no ofrecen acciones para resolver esa obligación', () => {
		render(Page, { data: { ...data, justCreated: false, deposit: deposit({ status: 'waived', waived_reason: 'policy_disabled' }) } });
		expect(panel()).toHaveTextContent('Exceptuada al apagar la seña del consultorio.');
		expect(panel().querySelector('form')).toBeNull();
		cleanup();
		render(Page, { data: { ...data, justCreated: false, appointment: { ...appointment, status: 'cancelled' }, deposit: deposit({ status: 'expired', expired_at: '2026-08-18T15:05:00.000Z' }) } });
		expect(panel()).toHaveTextContent('Venció sin registrarse: el turno se canceló automáticamente.');
		expect(panel().querySelector('form')).toBeNull();
		cleanup();
		render(Page, { data: { ...data, justCreated: false, canRecordDeposit: false, deposit: deposit() } });
		expect(panel()).toHaveTextContent('Seña pendiente');
		expect(panel().querySelector('form')).toBeNull();
	});

	it('la historia nombra las acciones de la seña con su monto', () => {
		render(Page, {
			data: {
				...data,
				justCreated: false,
				userLabels: { 'user-1': 'aye@consultorio.test' },
				auditLogs: [
					{ id: 'log-1', user_id: 'user-1', action: 'appointment.deposit_paid', metadata: { amount: 40000, deposit_status: 'paid' }, created_at: '2026-08-15T15:00:00.000Z' },
					{ id: 'log-slot', user_id: 'user-1', action: 'appointment.slot_release_hidden', metadata: {}, created_at: '2026-08-15T15:01:00.000Z' },
					{ id: 'log-2', user_id: null, action: 'appointment.deposit_expired', metadata: { from_status: 'reserved', to_status: 'cancelled' }, created_at: '2026-08-18T15:05:00.000Z' }
				]
			}
		});
		expect(screen.getByText('aye@consultorio.test confirmó la seña')).toBeInTheDocument();
		expect(screen.getByText('aye@consultorio.test ocultó un aviso de horario liberado')).toBeInTheDocument();
		expect(screen.getByText(/Seña de \$\s40\.000/)).toBeInTheDocument();
		expect(screen.getByText('El turno se canceló automáticamente porque no se registró la seña')).toBeInTheDocument();
	});
});


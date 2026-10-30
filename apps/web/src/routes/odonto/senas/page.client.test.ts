/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ search: '' }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(`http://localhost/odonto/senas${state.search}`);
		}
	}
}));

import Page from './+page.svelte';

const row = (overrides: Record<string, unknown> = {}) => ({
	appointmentId: '00000000-0000-4000-8000-0000000000a1',
	patientId: 'patient-1',
	patientName: 'Ana Pérez',
	turnLabel: 'viernes, 20 de noviembre a las 10:00',
	amountLabel: '$ 40.000',
	dueLabel: 'miércoles, 18 de noviembre a las 10:00',
	section: 'to_request',
	revision: 3,
	appointmentStatus: 'reserved',
	hasPhone: true,
	reminder: null,
	cancellation: null,
	...overrides
});

const SECTIONS = [
	{ id: 'to_request', title: 'Para pedir', folded: false },
	{ id: 'due_soon', title: 'Vencen en menos de 24 horas', folded: false },
	{ id: 'manual', title: 'Último momento: resolver a mano', folded: false },
	{ id: 'overdue', title: 'Vencidas sin cancelar: decidir', folded: false },
	{ id: 'later', title: 'Más adelante', folded: true },
	{ id: 'cancelled', title: 'Canceladas por falta de seña, últimos 7 días', folded: false }
] as const;

const data = (rows: ReturnType<typeof row>[], overrides: Record<string, unknown> = {}) =>
	({
		demo: false,
		restricted: false,
		canConfigure: false,
		policyEnabled: true,
		truncated: false,
		automation: { tone: 'ok', text: 'Última revisión automática: hace 3 min.' },
		sections: SECTIONS.map((section) => ({ ...section, rows: rows.filter((item) => item.section === section.id) })),
		...overrides
	}) as never;

// An Android phone: the page refines the device on mount, as Recordatorios does, and sends it.
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
beforeEach(() => {
	// userAgent is a getter of Navigator.prototype: it is defined, not assigned.
	vi.stubGlobal('navigator', Object.defineProperty(Object.create(navigator), 'userAgent', { value: ANDROID }));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	state.search = '';
});

describe('página de señas', () => {
	it('muestra cada sección con su cantidad y deja «Más adelante» plegada', () => {
		render(Page, {
			data: data([row(), row({ appointmentId: '00000000-0000-4000-8000-0000000000a2', section: 'later', patientName: 'Lejana' })])
		});
		expect(screen.getByRole('heading', { name: 'Para pedir (1)' })).toBeInTheDocument();
		const later = screen.getByText('Más adelante (1)').closest('details')!;
		expect(later).not.toHaveAttribute('open');
		expect(screen.queryByRole('heading', { name: /Vencen en menos/ })).toBeNull();
	});

	it('cada seña pendiente ofrece pedirla, confirmarla, exceptuarla y ver el turno, con la revisión que se vio', () => {
		render(Page, { data: data([row()]) });
		const card = document.querySelector('[data-deposit-row]') as HTMLElement;
		expect(within(card).getByRole('link', { name: 'Pedir seña por WhatsApp' })).toHaveAttribute(
			'href',
			'/odonto/senas/abrir/00000000-0000-4000-8000-0000000000a1?dispositivo=android'
		);
		const confirm = within(card).getByRole('button', { name: 'Confirmar seña' }).closest('form')!;
		expect(Object.fromEntries(new FormData(confirm))).toEqual({
			appointment_id: '00000000-0000-4000-8000-0000000000a1',
			deposit_action: 'paid',
			expected_revision: '3'
		});
		const waive = within(card).getByRole('button', { name: 'Sí, exceptuar la seña' }).closest('form')!;
		expect(new FormData(waive).get('deposit_action')).toBe('waived');
		expect(within(card).getByRole('link', { name: 'Ver turno' })).toHaveAttribute('href', '/odonto/turnos/00000000-0000-4000-8000-0000000000a1');
		expect(card).toHaveTextContent('Seña de $ 40.000, vence el miércoles, 18 de noviembre a las 10:00');
	});

	it('si ya se pidió por WhatsApp dice quién y cuándo, y abrirlo otra vez requiere confirmarlo', () => {
		render(Page, { data: data([row({ reminder: { openedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), openedBy: 'aye@consultorio.test' } })]) });
		expect(screen.getByText('WhatsApp abierto hace 2 h por aye@consultorio.test')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Pedir seña por WhatsApp' })).toBeNull();
		expect(screen.getByRole('link', { name: 'Abrir de todos modos' }).getAttribute('href')).toContain('confirmar=1');
	});

	it('sin teléfono válido no ofrece WhatsApp y lleva a corregir el número', () => {
		render(Page, { data: data([row({ hasPhone: false })]) });
		expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
		expect(screen.getByRole('link', { name: 'Corregir número' })).toHaveAttribute('href', '/odonto/pacientes/patient-1');
	});

	it('una cancelada por la seña ofrece avisarle a la persona y volver a dar el horario, nunca confirmarla', () => {
		render(Page, {
			data: data([
				row({
					section: 'cancelled',
					appointmentStatus: 'cancelled',
					cancellation: { rebookHref: '/odonto/agenda?hora=10%3A00', notice: { whatsappUrl: 'https://wa.me/5493421112222?text=hola', whatsappWebUrl: 'https://web.whatsapp.com/send?phone=5493421112222&text=hola' } }
				})
			])
		});
		expect(screen.getByRole('link', { name: 'Avisar a la persona' })).toHaveAttribute('href', 'https://wa.me/5493421112222?text=hola');
		expect(screen.getByRole('link', { name: 'Volver a dar este horario' })).toHaveAttribute('href', '/odonto/agenda?hora=10%3A00');
		expect(screen.queryByRole('button', { name: 'Confirmar seña' })).toBeNull();
		expect(screen.getByText(/Se canceló porque no se registró la seña de \$ 40\.000/)).toBeInTheDocument();
	});

	it('explica por qué volvió a la lista en vez de abrir WhatsApp', () => {
		state.search = '?aviso=ya_abierto';
		render(Page, { data: data([row()]) });
		expect(screen.getByRole('status')).toHaveTextContent('Ya se abrió el WhatsApp para pedir esa seña.');
	});

	it('una alerta del registro de ejecución se muestra como alerta', () => {
		render(Page, {
			data: data([], { automation: { tone: 'warning', text: 'La revisión automática no corre desde hace 25 min. Revisá a mano las señas vencidas.' } })
		});
		expect(screen.getByRole('alert')).toHaveTextContent('La revisión automática no corre desde hace 25 min.');
	});

	it('con la seña apagada lo dice, y sólo quien configura ve el enlace', () => {
		render(Page, { data: data([], { policyEnabled: false, canConfigure: true }) });
		expect(screen.getByRole('link', { name: 'Configurar las señas' })).toHaveAttribute('href', '/odonto/configuracion/senas');
		cleanup();
		render(Page, { data: data([], { policyEnabled: false, canConfigure: false }) });
		expect(screen.getByText(/no pide señas en este momento/)).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Configurar las señas' })).toBeNull();
	});

	it('si la lista no entra completa lo dice, y sin señas dice que no hay nada pendiente', () => {
		render(Page, { data: data([row()], { truncated: true }) });
		expect(screen.getByRole('alert')).toHaveTextContent('Hay más señas de las que entran en esta lista');
		cleanup();
		render(Page, { data: data([]) });
		expect(screen.getByText('No hay señas para pedir ni turnos cancelados por la seña en los últimos 7 días.')).toBeInTheDocument();
	});

	it('un consultorio restringido no muestra acciones', () => {
		render(Page, { data: data([], { restricted: true, automation: null }) });
		expect(screen.getByText(/acceso comercial del consultorio está restringido/)).toBeInTheDocument();
		expect(screen.queryByRole('button')).toBeNull();
	});
});

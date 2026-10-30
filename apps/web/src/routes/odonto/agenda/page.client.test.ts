/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/navigation', () => ({ afterNavigate: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/odonto/agenda?date=2026-08-27') } }));

const appointment = (id: string, fullName: string) => ({
	id,
	patient_id: `patient-${id}`,
	service_id: 'service-1',
	professional_id: 'professional-1',
	starts_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
	ends_at: new Date(Date.now() - 23.5 * 60 * 60 * 1000).toISOString(),
	status: 'reserved',
	source: 'manual',
	service_name_snapshot: 'Consulta',
	professional_name_snapshot: 'Profesional',
	internal_note: null,
	patients: { full_name: fullName, phone_e164: null }
});

const data = {
	context: { canOperate: false, business: { id: 'business-1' } },
	date: '2026-08-27',
	anyDay: false,
	anyDayLimited: false,
	selectedProfessionalId: '',
	selectedStatus: '',
	selectedServiceId: '',
	selectedPatientId: '',
	selectedTime: '',
	searchApplied: false,
	appointments: [],
	stats: [],
	totalAppointments: 0,
	professionals: [
		{ id: 'professional-1', name: 'Profesional', specialty: null, is_active: true }
	],
	services: [{ id: 'service-1', name: 'Consulta', duration_minutes: 30 }],
	serviceProfessionalIds: { 'service-1': ['professional-1'] },
	availabilitySnapshot: null,
	patients: [],
	patientsLoaded: false,
	referencesLoaded: true,
	reminderCount: 0,
	depositAlerts: { toRequest: 0, dueSoon: 0, cancelledToday: 0 } as null | { toRequest: number; dueSoon: number; cancelledToday: number },
	appointmentRequestId: 'request-1',
	demo: false
};

const jsonResponse = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});

const originalAnimate = Element.prototype.animate;

beforeEach(() => {
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		callback(0);
		return 1;
	});
	HTMLElement.prototype.scrollIntoView = vi.fn();
	Element.prototype.animate = vi.fn(
		() =>
			({
				cancel: vi.fn(),
				finish: vi.fn(),
				finished: Promise.resolve()
			}) as unknown as Animation
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Element.prototype.animate = originalAnimate;
});

describe('buscador incremental de Agenda', () => {
	it('mantiene los resultados compatibles mientras reconcilia cada prefijo', async () => {
		const federico = appointment('federico', 'Federico Montana');
		const fernando = appointment('fernando', 'Fernando Lopez');
		let resolveFernandoSearch: ((response: Response) => void) | undefined;
		const pendingFernandoSearch = new Promise<Response>((resolve) => {
			resolveFernandoSearch = resolve;
		});
		const fetchMock = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/odonto/agenda/referencias')) {
				return Promise.resolve(
					jsonResponse({
						professionals: data.professionals,
						services: data.services,
						service_professional_ids: data.serviceProfessionalIds,
						availability_snapshot: null
					})
				);
			}
			if (url.includes('/odonto/agenda/buscar/precarga')) {
				return Promise.resolve(jsonResponse({ appointments: [] }));
			}
			if (url.includes('q=fer')) return pendingFernandoSearch;
			if (url.includes('q=fe')) {
				return Promise.resolve(jsonResponse({ upcoming: [], past: [federico, fernando] }));
			}
			return Promise.resolve(jsonResponse({ upcoming: [], past: [] }));
		});
		vi.stubGlobal('fetch', fetchMock);
		const user = userEvent.setup();

		render(Page, { data });
		await user.click(screen.getByRole('button', { name: 'Buscar' }));
		const input = screen.getByRole('searchbox', { name: 'Paciente o teléfono' });
		await user.type(input, 'fe');

		await waitFor(() => {
			expect(screen.getByText('Federico Montana')).toBeInTheDocument();
			expect(screen.getByText('Fernando Lopez')).toBeInTheDocument();
		});

		await user.type(input, 'r');
		await waitFor(() => {
			expect(screen.queryByText('Federico Montana')).not.toBeInTheDocument();
			expect(screen.getByText('Fernando Lopez')).toBeInTheDocument();
		});
		expect(screen.queryByText(/Buscando|Cargando profesionales/)).not.toBeInTheDocument();

		resolveFernandoSearch?.(jsonResponse({ upcoming: [], past: [fernando] }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/odonto/agenda/buscar?q=fer', expect.anything()));
		expect(screen.getByText('Fernando Lopez')).toBeInTheDocument();
	});
});

describe('señas en la agenda', () => {
	// A turn later today, so the label is the stored status and never «Expirado».
	const upcoming = (id: string, status: string, depositStatus: string | null) => ({
		...appointment(id, `Paciente ${id}`),
		starts_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
		ends_at: new Date(Date.now() + 2.5 * 60 * 60 * 1000).toISOString(),
		status,
		appointment_deposits: depositStatus ? { status: depositStatus, revision: 7, waived_reason: null } : null
	});

	it('ofrece registrar, exceptuar y deshacer desde la agenda con la revisión observada', () => {
		render(Page, { data: { ...data, context: { ...data.context, canOperate: true }, canRecordDeposit: true,
			appointments: [upcoming('a', 'reserved', 'pending'), upcoming('b', 'confirmed', 'paid')]
		} as never });
		const pending = document.querySelector('[data-agenda-deposit="a"]') as HTMLElement;
		const received = document.querySelector('[data-agenda-deposit="b"]') as HTMLElement;
		expect(pending).not.toBeNull();
		expect(received).not.toBeNull();
		const paidForm = within(pending).getByRole('button', { name: 'Confirmar seña' }).closest('form')!;
		expect(paidForm).toHaveAttribute('action', '/odonto/turnos/a?/deposit');
		expect(Object.fromEntries(new FormData(paidForm))).toEqual({ deposit_action: 'paid', expected_revision: '7' });
		expect(pending.querySelector('form input[value="waived"]')).not.toBeNull();
		expect(received.querySelector('form input[value="pending"]')).not.toBeNull();
	});

	it('no ofrece acciones de seña sin permiso, con política apagada o en un turno cancelado', () => {
		const disabledPolicy = { ...upcoming('c', 'reserved', 'waived'), appointment_deposits: { status: 'waived', revision: 8, waived_reason: 'policy_disabled' } };
		render(Page, { data: { ...data, context: { ...data.context, canOperate: true }, canRecordDeposit: true,
			appointments: [disabledPolicy, upcoming('d', 'cancelled', 'expired')]
		} as never });
		expect(document.querySelector('[data-agenda-deposit]')).toBeNull();
		cleanup();
		render(Page, { data: { ...data, canRecordDeposit: false, appointments: [upcoming('a', 'reserved', 'pending')] } as never });
		expect(document.querySelector('[data-agenda-deposit]')).toBeNull();
	});

	it('cada tarjeta dice el estado con su seña, con el mismo dato que filtros y conteos', () => {
		render(Page, {
			data: {
				...data,
				appointments: [upcoming('a', 'reserved', 'pending'), upcoming('b', 'confirmed', 'paid'), upcoming('c', 'reserved', null)]
			} as never
		});
		const pending = screen.getByText('Reservado, seña pendiente');
		expect(pending).toHaveClass('ux-badge-warning');
		expect(screen.getByText('Confirmado, seña recibida')).toBeInTheDocument();
		expect(screen.getByText('Reservado')).toBeInTheDocument();
	});

	it('avisa qué hacer con las señas en una sola línea, con el enlace a la lista', () => {
		render(Page, { data: { ...data, depositAlerts: { toRequest: 3, dueSoon: 1, cancelledToday: 2 } } as never });
		const alert = document.querySelector('[data-deposit-alert]') as HTMLElement;
		expect(alert).toHaveTextContent('3 señas para pedir, 1 vence en menos de 24 horas, 2 turnos se cancelaron por falta de seña.');
		expect(alert.querySelector('a')).toHaveAttribute('href', '/odonto/senas');
	});

	it('sin nada que hacer no avisa, y si no pudo comprobarlas lo dice', () => {
		render(Page, { data } as never);
		expect(document.querySelector('[data-deposit-alert]')).toBeNull();
		cleanup();
		render(Page, { data: { ...data, depositAlerts: null } } as never);
		expect(document.querySelector('[data-deposit-alert]')).toHaveTextContent('No pudimos comprobar las señas.');
	});
});


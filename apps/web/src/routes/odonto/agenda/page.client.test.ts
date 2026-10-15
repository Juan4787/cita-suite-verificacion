/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/navigation', () => ({ afterNavigate: vi.fn() }));

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

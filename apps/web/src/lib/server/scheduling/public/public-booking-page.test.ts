import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	loadPublicBookingState: vi.fn(),
	loadDepositTermsForSlots: vi.fn(),
	logServerFailure: vi.fn(),
	rpc: vi.fn(),
	createPublicBooking: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { DEMO_MODE: 'false' } }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: mocks.logServerFailure }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock('$lib/server/patients/public/booking-information', () => ({
	bookingInformationEnabled: () => false,
	loadProfessionalBookingSchema: vi.fn(),
	informationErrorMessage: vi.fn()
}));
vi.mock('$lib/server/scheduling/public/public-booking', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/scheduling/public/public-booking')>()),
	loadPublicBookingState: mocks.loadPublicBookingState,
	createPublicBooking: mocks.createPublicBooking
}));
vi.mock('$lib/server/scheduling/public/deposits', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/scheduling/public/deposits')>()),
	loadDepositTermsForSlots: mocks.loadDepositTermsForSlots
}));

const { loadPublicBookingPage, submitPublicBookingPage } = await import('./public-booking-page');

const BUSINESS_ID = '00000000-0000-4000-8000-0000000000b1';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000d1';
const PROFESSIONAL_ID = '00000000-0000-4000-8000-0000000000e1';
// The quote as the database returns it: its policy holds the rounding unit of a percentage.
const RAW_QUOTE = {
	policy_id: '00000000-0000-4000-8000-0000000000f1',
	revision: 1,
	service_id: SERVICE_ID,
	professional_ids: [PROFESSIONAL_ID],
	date: '2026-11-20',
	amount: 115000,
	currency: 'ARS',
	base_amount: 115000,
	current_amount: 115000,
	month: '2026-11-01',
	adjusted: false,
	hash: 'a'.repeat(64)
};
const SLOTS = ['2026-11-20T12:00:00.000Z', '2026-11-20T13:00:00.000Z'].map((startsAt) => ({
	date: '2026-11-20',
	time: startsAt.slice(11, 16),
	starts_at: startsAt,
	ends_at: startsAt,
	professional_id: PROFESSIONAL_ID,
	professional_name: 'Dra. Frutos'
}));

const state = (overrides: Record<string, unknown> = {}) => ({
	business: { id: BUSINESS_ID, name: 'Consultorio', timezone: 'America/Argentina/Cordoba', address: null, maps_url: null },
	services: [{ id: SERVICE_ID, name: 'Consulta', description: null, duration_minutes: 60, price_label: null }],
	professionals: [{ id: PROFESSIONAL_ID, name: 'Dra. Frutos', specialty: null }],
	days: [{ date: '2026-11-20', label: 'Viernes', count: 2 }],
	slots: SLOTS,
	issue: null,
	...overrides
});

const event = (search = `?service_id=${SERVICE_ID}&professional_id=${PROFESSIONAL_ID}&date=2026-11-20`) =>
	({
		params: { businessSlug: BUSINESS_ID },
		fetch: vi.fn(),
		url: new URL(`http://localhost/reservar/${BUSINESS_ID}${search}`),
		setHeaders: vi.fn()
	}) as never;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.loadPublicBookingState.mockResolvedValue(state());
	mocks.rpc.mockImplementation(async (name: string) =>
		name === 'get_public_service_price_quote' ? { data: RAW_QUOTE, error: null } : { data: [], error: null }
	);
	mocks.loadDepositTermsForSlots.mockResolvedValue({
		'2026-11-20T13:00:00.000Z': { amount: 40000, dueAt: '2026-11-18T13:00:00+00:00', autoCancel: true }
	});
});

describe('condiciones de la seña en el turnero', () => {
	it('envía las condiciones mostradas a la creación y rechaza un formulario de condiciones inválido', async () => {
		const terms = { amount: 40000, dueAt: '2026-11-18T13:00:00.000Z', autoCancel: true };
		const submitEvent = (depositTerms: string) => ({
			params: { businessSlug: BUSINESS_ID }, fetch: vi.fn(), url: new URL('http://localhost/reservar/consultorio'), getClientAddress: () => '127.0.0.1',
			request: new Request('http://localhost/reservar/consultorio?/create_booking', { method: 'POST', body: new URLSearchParams({
				service_id: SERVICE_ID, professional_id: PROFESSIONAL_ID, slot_starts_at: '2026-11-20T13:00:00.000Z',
				patient_name: 'Ana Prueba', patient_phone: '3425048209', idempotency_key: '00000000-0000-4000-8000-0000000000a1', deposit_terms: depositTerms
			}) })
		}) as never;
		mocks.createPublicBooking.mockResolvedValue({ appointment: { confirmation_token: 'owned-token' } });
		await expect(submitPublicBookingPage(submitEvent(JSON.stringify(terms)))).rejects.toMatchObject({ status: 303, location: '/turno/owned-token?creado=1' });
		expect(mocks.createPublicBooking).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ depositTerms: terms }));
		mocks.createPublicBooking.mockClear();
		await expect(submitPublicBookingPage(submitEvent('{"amount":"40000"}'))).resolves.toMatchObject({ status: 400, data: { message: expect.stringMatching(/No pudimos leer las condiciones de la seña/) } });
		expect(mocks.createPublicBooking).not.toHaveBeenCalled();
		mocks.createPublicBooking.mockRejectedValueOnce(new Error('DEPOSIT_TERMS_CHANGED'));
		await expect(submitPublicBookingPage(submitEvent(JSON.stringify(terms)))).resolves.toMatchObject({
			status: 400, data: { refreshDepositTerms: true, values: { patient_name: 'Ana Prueba' } }
		});
	});
	it('pide las de todos los horarios del día con la cotización tal como la devolvió la base', async () => {
		const result = (await loadPublicBookingPage(event(), undefined, 'public_page')) as { depositTerms: unknown };
		expect(mocks.loadDepositTermsForSlots).toHaveBeenCalledWith(expect.anything(), {
			businessId: BUSINESS_ID,
			serviceId: SERVICE_ID,
			slotStartsAt: SLOTS.map((slot) => slot.starts_at),
			source: 'public_booking',
			priceQuote: RAW_QUOTE
		});
		expect(result.depositTerms).toEqual({
			'2026-11-20T13:00:00.000Z': { amount: 40000, dueAt: '2026-11-18T13:00:00+00:00', autoCancel: true }
		});
	});

	it('si no se pueden calcular, la reserva sigue y la página lo distingue de «sin seña»', async () => {
		mocks.loadDepositTermsForSlots.mockRejectedValue(new Error('read failed'));
		const result = (await loadPublicBookingPage(event(), undefined, 'public_page')) as { depositTerms: unknown; state: { slots: unknown[] } };
		expect(result.depositTerms).toBeNull();
		expect(result.state.slots).toHaveLength(2);
		expect(mocks.logServerFailure).toHaveBeenCalled();
	});

	it('sin día elegido no consulta nada', async () => {
		mocks.loadPublicBookingState.mockResolvedValue(state({ slots: [] }));
		const result = (await loadPublicBookingPage(event(`?service_id=${SERVICE_ID}&professional_id=${PROFESSIONAL_ID}`), undefined, 'public_page')) as {
			depositTerms: unknown;
		};
		expect(result.depositTerms).toEqual({});
		expect(mocks.loadDepositTermsForSlots).not.toHaveBeenCalled();
	});

	it('con horarios pero sin la cotización que fijaría la reserva no presenta condiciones como ciertas', async () => {
		// The chosen day is not among the available days: no quote is computed for it.
		mocks.loadPublicBookingState.mockResolvedValue(state({ days: [] }));
		const result = (await loadPublicBookingPage(event(), undefined, 'public_page')) as { depositTerms: unknown };
		expect(result.depositTerms).toBeNull();
		expect(mocks.loadDepositTermsForSlots).not.toHaveBeenCalled();
	});
});

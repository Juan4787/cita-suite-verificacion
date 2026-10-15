import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn(),
	getOdontoContext: vi.fn(),
	rpc: vi.fn(),
	from: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/business', () => ({ ACTIVE_BUSINESS_COOKIE: 'active-business-id' }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient
}));
vi.mock('$lib/server/odonto-context', () => ({
	getOdontoContext: mocks.getOdontoContext
}));

const { GET } = await import('./+server');

const businessId = '00000000-0000-4000-8000-000000000001';
const supabase = { rpc: mocks.rpc, from: mocks.from };

const makeEvent = (query = 'Juan', cookieValue: string | undefined = businessId) =>
	({
		url: new URL(`http://localhost/odonto/agenda/buscar?q=${encodeURIComponent(query)}`),
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn(() => cookieValue) },
		setHeaders: vi.fn()
	}) as any;

describe('agenda active appointment search endpoint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createSupabaseServerClient.mockResolvedValue(supabase);
		mocks.getOdontoContext.mockResolvedValue({
			supabase,
			business: { business: { id: businessId }, role: 'owner' },
			userId: 'user-1'
		});
	});

	it('returns an empty result without opening a database client for a blank query', async () => {
		const response = await GET(makeEvent('   '));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ upcoming: [], past: [] });
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
		expect(mocks.rpc).not.toHaveBeenCalled();
	});

	it('uses one authorized RPC instead of scanning patients and then appointments', async () => {
		const appointment = {
			id: 'appointment-1',
			starts_at: '2099-08-24T12:00:00.000Z',
			status: 'reserved',
			patients: { full_name: 'Juan Pérez', phone_e164: '+5491112345678' }
		};
		mocks.rpc.mockResolvedValue({ data: [appointment], error: null });

		const response = await GET(makeEvent('Juan'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ upcoming: [appointment], past: [] });
		expect(mocks.rpc).toHaveBeenCalledTimes(1);
		expect(mocks.rpc).toHaveBeenCalledWith('search_upcoming_active_appointments', {
			p_business_id: businessId,
			p_query: 'Juan',
			p_limit: 60
		});
		expect(mocks.from).not.toHaveBeenCalled();
		expect(mocks.getOdontoContext).not.toHaveBeenCalled();
	});

	it('keeps a recent active appointment in the expired group', async () => {
		const appointment = {
			id: 'appointment-past',
			starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
			status: 'reserved',
			patients: { full_name: 'Ermenegildo', phone_e164: '+5493428963125' }
		};
		mocks.rpc.mockResolvedValue({ data: [appointment], error: null });

		const response = await GET(makeEvent('Ermenegildo'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ upcoming: [], past: [appointment] });
	});

	it('does not return active appointments older than three months', async () => {
		const appointment = {
			id: 'appointment-too-old',
			starts_at: '2020-08-24T12:00:00.000Z',
			status: 'reserved',
			patients: { full_name: 'Ermenegildo', phone_e164: '+5493428963125' }
		};
		mocks.rpc.mockResolvedValue({ data: [appointment], error: null });

		const response = await GET(makeEvent('Ermenegildo'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ upcoming: [], past: [] });
	});

	it('falls back to the regular business resolver when the active cookie is unavailable', async () => {
		mocks.rpc.mockResolvedValue({ data: [], error: null });

		const response = await GET(makeEvent('Juan', ''));

		expect(response.status).toBe(200);
		expect(mocks.getOdontoContext).toHaveBeenCalledWith(
			expect.objectContaining({ membershipCache: 'fresh' })
		);
		expect(mocks.rpc).toHaveBeenCalledWith(
			'search_upcoming_active_appointments',
			expect.objectContaining({ p_business_id: businessId })
		);
	});

	it('keeps authorization failures human and free of database details', async () => {
		mocks.rpc.mockResolvedValue({
			data: null,
			error: { message: 'AGENDA_SEARCH_DENIED', code: 'P0001' }
		});

		const response = await GET(makeEvent('Juan'));

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			message: 'No tenés permisos para buscar en la agenda.'
		});
	});
});

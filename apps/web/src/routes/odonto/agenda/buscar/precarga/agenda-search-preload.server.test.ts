import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn(),
	getOdontoContext: vi.fn(),
	rpc: vi.fn()
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
const supabase = { rpc: mocks.rpc };

const makeEvent = (cookieValue: string | undefined = businessId) => {
	const setHeaders = vi.fn();
	return {
		event: {
			locals: { auth: { access_token: 'test-token' } },
			fetch: vi.fn(),
			cookies: { get: vi.fn(() => cookieValue) },
			setHeaders
		} as any,
		setHeaders
	};
};

describe('agenda active appointment preload endpoint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createSupabaseServerClient.mockResolvedValue(supabase);
		mocks.getOdontoContext.mockResolvedValue({
			supabase,
			business: { business: { id: businessId }, role: 'owner' },
			userId: 'user-1'
		});
	});

	it('loads one bounded authorized snapshot and prevents shared caching', async () => {
		const appointment = {
			id: 'appointment-1',
			starts_at: '2026-08-24T12:00:00.000Z',
			status: 'reserved',
			patients: { full_name: 'Juan Pérez', phone_e164: '+5491112345678' }
		};
		mocks.rpc.mockResolvedValue({ data: [appointment], error: null });
		const { event, setHeaders } = makeEvent();

		const response = await GET(event);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ appointments: [appointment] });
		expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
		expect(mocks.rpc).toHaveBeenCalledTimes(1);
		expect(mocks.rpc).toHaveBeenCalledWith('list_upcoming_active_appointments_snapshot', {
			p_business_id: businessId,
			p_limit: 400
		});
		expect(mocks.getOdontoContext).not.toHaveBeenCalled();
	});

	it('falls back to the regular business resolver without a valid active cookie', async () => {
		mocks.rpc.mockResolvedValue({ data: [], error: null });
		const { event } = makeEvent('');

		await GET(event);

		expect(mocks.getOdontoContext).toHaveBeenCalledWith(
			expect.objectContaining({ membershipCache: 'fresh' })
		);
		expect(mocks.rpc).toHaveBeenCalledWith(
			'list_upcoming_active_appointments_snapshot',
			expect.objectContaining({ p_business_id: businessId })
		);
	});

	it('keeps authorization failures human and free of database details', async () => {
		mocks.rpc.mockResolvedValue({
			data: null,
			error: { message: 'AGENDA_SEARCH_DENIED', code: 'P0001' }
		});
		const { event } = makeEvent();

		const response = await GET(event);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			message: 'No tenés permisos para buscar en la agenda.'
		});
	});
});

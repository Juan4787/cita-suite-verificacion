import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	resolveActiveBusiness: vi.fn(),
	isDefaultBusinessPendingManualSetupError: vi.fn((_error?: unknown) => false),
	isDefaultBusinessSetupUnavailableError: vi.fn((_error?: unknown) => false),
	createSupabaseServerClient: vi.fn(),
	getAuthUserId: vi.fn()
}));

vi.mock('$lib/server/access/public/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness,
	isDefaultBusinessPendingManualSetupError: mocks.isDefaultBusinessPendingManualSetupError,
	isDefaultBusinessSetupUnavailableError: mocks.isDefaultBusinessSetupUnavailableError
}));

vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getAuthUserId: mocks.getAuthUserId
}));

const { RateLimitExceededError } = await import('$lib/server/platform/rate-limits');
const { getOdontoContext } = await import('$lib/server/access/public/odonto-context');

const options = () => ({
	locals: {
		verifiedUser: { id: 'user-1', email: 'owner@example.test' },
		auth: { module: 'odonto', access_token: 'access', refresh_token: 'refresh' }
	},
	fetch: vi.fn(),
	cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() }
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createSupabaseServerClient.mockResolvedValue({});
	mocks.getAuthUserId.mockResolvedValue('user-1');
	mocks.isDefaultBusinessPendingManualSetupError.mockReturnValue(false);
	mocks.isDefaultBusinessSetupUnavailableError.mockReturnValue(false);
});

describe('getOdontoContext onboarding errors', () => {
	it('reutiliza la identidad verificada y la pasa a la resolución del consultorio', async () => {
		const business = { business: { id: 'business-1' }, role: 'owner' };
		mocks.resolveActiveBusiness.mockResolvedValueOnce(business);
		const result = await getOdontoContext(options() as never);
		expect(result.userId).toBe('user-1');
		expect(mocks.getAuthUserId).not.toHaveBeenCalled();
		expect(mocks.resolveActiveBusiness).toHaveBeenCalledWith(expect.objectContaining({ verifiedUserId: 'user-1', membershipCache: 'fresh' }));
	});

	it('shares the membership read of a request that cannot write and reads again in one that can', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue({ business: { id: 'business-1' }, role: 'owner' });
		for (const membershipCache of ['request', 'fresh'] as const) {
			const request = options();
			await getOdontoContext({ ...request, locals: { ...request.locals, membershipCache } } as never);
			expect(mocks.resolveActiveBusiness).toHaveBeenLastCalledWith(expect.objectContaining({ membershipCache }));
		}
	});

	it('sin identidad de hooks valida Auth en vez de decodificar el token', async () => {
		const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('invalid token') });
		mocks.createSupabaseServerClient.mockResolvedValueOnce({ auth: { getUser } });
		const request = options();
		const locals = { auth: request.locals.auth };
		await expect(getOdontoContext({ ...request, locals } as never)).rejects.toMatchObject({ status: 303, location: '/login' });
		expect(getUser).toHaveBeenCalledWith('access');
		expect(mocks.getAuthUserId).not.toHaveBeenCalled();
		expect(mocks.resolveActiveBusiness).not.toHaveBeenCalled();
	});

	it('envía el alta manual a una pantalla explícita', async () => {
		const setupError = new Error('DEFAULT_BUSINESS_PENDING_MANUAL_SETUP');
		mocks.resolveActiveBusiness.mockRejectedValueOnce(setupError);
		mocks.isDefaultBusinessPendingManualSetupError.mockImplementation(
			(error: unknown) => error === setupError
		);

		await expect(getOdontoContext(options() as never)).rejects.toMatchObject({
			status: 303,
			location: '/odonto/pendiente?reason=manual_setup'
		});
	});

	it('explica el límite real sin caer en una página 500', async () => {
		mocks.resolveActiveBusiness.mockRejectedValueOnce(
			new RateLimitExceededError('Hicimos varios intentos de preparar tu consultorio.', 60)
		);

		await expect(getOdontoContext(options() as never)).rejects.toMatchObject({
			status: 303,
			location: '/odonto/pendiente?reason=rate_limited'
		});
	});

	it('explica una dependencia temporalmente caída sin exponer el error interno', async () => {
		const setupError = new Error('DEFAULT_BUSINESS_SETUP_UNAVAILABLE');
		mocks.resolveActiveBusiness.mockRejectedValueOnce(setupError);
		mocks.isDefaultBusinessSetupUnavailableError.mockImplementation(
			(error: unknown) => error === setupError
		);
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await expect(getOdontoContext(options() as never)).rejects.toMatchObject({
			status: 303,
			location: '/odonto/pendiente?reason=temporarily_unavailable'
		});
		expect(log).toHaveBeenCalledWith('No se pudo preparar el consultorio inicial', {});
		log.mockRestore();
	});

	it('trata un contexto vacío como alta temporalmente incompleta', async () => {
		mocks.resolveActiveBusiness.mockResolvedValueOnce(null);

		await expect(getOdontoContext(options() as never)).rejects.toMatchObject({
			status: 303,
			location: '/odonto/pendiente?reason=temporarily_unavailable'
		});
	});
});

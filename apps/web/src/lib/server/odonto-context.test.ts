import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	resolveActiveBusiness: vi.fn(),
	isDefaultBusinessPendingManualSetupError: vi.fn((_error?: unknown) => false),
	isDefaultBusinessSetupUnavailableError: vi.fn((_error?: unknown) => false),
	createSupabaseServerClient: vi.fn(),
	getAuthUserId: vi.fn()
}));

vi.mock('./business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness,
	isDefaultBusinessPendingManualSetupError: mocks.isDefaultBusinessPendingManualSetupError,
	isDefaultBusinessSetupUnavailableError: mocks.isDefaultBusinessSetupUnavailableError
}));

vi.mock('./supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getAuthUserId: mocks.getAuthUserId
}));

const { RateLimitExceededError } = await import('./rate-limits');
const { getOdontoContext } = await import('./odonto-context');

const options = () => ({
	locals: {
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
		expect(log).toHaveBeenCalledWith('No se pudo preparar el consultorio inicial', setupError);
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

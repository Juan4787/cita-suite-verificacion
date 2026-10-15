import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {
		RATE_LIMIT_SALT: 'test-salt',
		DEMO_MODE: undefined as string | undefined
	},
	createSupabaseAdminClient: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('./supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));

const {
	enforceRateLimits,
	enforceRateLimitsFailOpen,
	hashRateLimitSubject,
	loginPasswordRateLimitRules,
	pendingBusinessCreationRateLimitRules,
	radiographOriginalAccessRateLimitRules,
	radiographRestoreRateLimitRules,
	radiographTrashRateLimitRules,
	radiographUploadRateLimitRules,
	rateLimitFail,
	signupEmailRateLimitRules,
	RateLimitExceededError,
	RateLimitUnavailableError
} = await import('./rate-limits');

beforeEach(() => {
	vi.clearAllMocks();
	mocks.env.DEMO_MODE = undefined;
});

describe('rate limits server helper', () => {
	it('hashea subjects antes de enviarlos a la RPC', async () => {
		const rpc = vi.fn(async () => ({ data: [{ allowed: true, used: 1, retry_after_seconds: 0 }], error: null }));
		mocks.createSupabaseAdminClient.mockResolvedValue({ rpc });

		await enforceRateLimits(loginPasswordRateLimitRules('Cliente@Example.com', '203.0.113.10'), vi.fn() as never);

		expect(rpc).toHaveBeenCalledWith(
			'consume_server_rate_limits',
			expect.objectContaining({
				p_action: 'login_password_by_email',
				p_subject_hash: hashRateLimitSubject('Cliente@Example.com'),
				p_windows: [{ limit_count: 5, window_seconds: 900 }]
			})
		);
		expect(rpc).toHaveBeenCalledWith(
			'consume_server_rate_limits',
			expect.objectContaining({
				p_action: 'login_password_by_ip',
				p_subject_hash: hashRateLimitSubject('203.0.113.10'),
				p_windows: [{ limit_count: 40, window_seconds: 900 }]
			})
		);
	});

	it('agrupa ventanas de la misma acción en un solo consumo', async () => {
		const rpc = vi.fn(async () => ({ data: [{ allowed: true, used: 1, retry_after_seconds: 0 }], error: null }));
		mocks.createSupabaseAdminClient.mockResolvedValue({ rpc });

		await enforceRateLimits(signupEmailRateLimitRules('cliente@example.com', '203.0.113.10'));

		expect(rpc).toHaveBeenCalledWith(
			'consume_server_rate_limits',
			expect.objectContaining({
				p_action: 'signup_email_by_email',
				p_subject_hash: hashRateLimitSubject('cliente@example.com'),
				p_windows: [
					{ limit_count: 3, window_seconds: 3600 },
					{ limit_count: 8, window_seconds: 86400 }
				]
			})
		);
		expect(rpc).toHaveBeenCalledWith(
			'consume_server_rate_limits',
			expect.objectContaining({
				p_action: 'signup_email_by_ip',
				p_subject_hash: hashRateLimitSubject('203.0.113.10'),
				p_windows: [
					{ limit_count: 30, window_seconds: 3600 },
					{ limit_count: 80, window_seconds: 86400 }
				]
			})
		);
		expect(rpc).toHaveBeenCalledTimes(2);
	});

	it('arroja RateLimitExceededError cuando la RPC bloquea', async () => {
		const rpc = vi.fn(async () => ({
			data: [{ allowed: false, used: 5, retry_after_seconds: 120 }],
			error: null
		}));
		mocks.createSupabaseAdminClient.mockResolvedValue({ rpc });

		await expect(
			enforceRateLimits(loginPasswordRateLimitRules('cliente@example.com', '203.0.113.10'))
		).rejects.toBeInstanceOf(RateLimitExceededError);
	});

	it('clasifica una dependencia caída sin confundirla con un límite alcanzado', async () => {
		mocks.createSupabaseAdminClient.mockRejectedValueOnce(new Error('service role ausente'));

		await expect(
			enforceRateLimits(loginPasswordRateLimitRules('cliente@example.com', '203.0.113.10'))
		).rejects.toBeInstanceOf(RateLimitUnavailableError);
	});

	it('permite continuar sólo en la política fail-open y conserva los límites reales', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mocks.createSupabaseAdminClient.mockRejectedValueOnce(new Error('RPC no disponible'));

		await expect(
			enforceRateLimitsFailOpen(
				loginPasswordRateLimitRules('cliente@example.com', '203.0.113.10'),
				{ logContext: 'control de ingreso' }
			)
		).resolves.toBeUndefined();
		expect(log).toHaveBeenCalledWith('control de ingreso', expect.any(RateLimitUnavailableError));

		const rpc = vi.fn(async () => ({
			data: [{ allowed: false, used: 5, retry_after_seconds: 120 }],
			error: null
		}));
		mocks.createSupabaseAdminClient.mockResolvedValueOnce({ rpc });
		await expect(
			enforceRateLimitsFailOpen(
				loginPasswordRateLimitRules('cliente@example.com', '203.0.113.10'),
				{ logContext: 'control de ingreso' }
			)
		).rejects.toBeInstanceOf(RateLimitExceededError);
		log.mockRestore();
	});

	it('usa un mensaje específico y 503 cuando una operación fail-closed no puede validar', () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const result = rateLimitFail(new RateLimitUnavailableError(new Error('RPC caída')), {
			logContext: 'control de suscripción',
			unavailableMessage: 'No pudimos preparar la suscripción. No se generó ningún cobro.'
		});

		expect(result).toEqual({
			status: 503,
			message: 'No pudimos preparar la suscripción. No se generó ningún cobro.'
		});
		expect(log).toHaveBeenCalledOnce();
		log.mockRestore();
	});

	it('protege el alta inicial siempre por usuario y suma IP cuando está disponible', () => {
		expect(pendingBusinessCreationRateLimitRules('user-1')).toEqual([
			expect.objectContaining({ action: 'pending_business_creation_by_user', subject: 'user-1' })
		]);
		expect(pendingBusinessCreationRateLimitRules('user-1', '203.0.113.10')).toEqual([
			expect.objectContaining({ action: 'pending_business_creation_by_user', subject: 'user-1' }),
			expect.objectContaining({ action: 'pending_business_creation_by_ip', subject: '203.0.113.10' })
		]);
	});

	it('define límites clínicos acotados por usuario y agrupa las dos ventanas de carga', async () => {
		const rpc = vi.fn(async () => ({
			data: [{ allowed: true, used: 1, retry_after_seconds: 0 }],
			error: null
		}));
		mocks.createSupabaseAdminClient.mockResolvedValue({ rpc });

		await enforceRateLimits(radiographUploadRateLimitRules('user-1'));
		await enforceRateLimits(radiographOriginalAccessRateLimitRules('user-1'));
		await enforceRateLimits(radiographTrashRateLimitRules('user-1'));
		await enforceRateLimits(radiographRestoreRateLimitRules('user-1'));

		expect(rpc).toHaveBeenNthCalledWith(
			1,
			'consume_server_rate_limits',
			expect.objectContaining({
				p_action: 'radiograph_upload_by_user',
				p_windows: [
					{ limit_count: 6, window_seconds: 60 },
					{ limit_count: 60, window_seconds: 3600 }
				]
			})
		);
		expect(rpc).toHaveBeenNthCalledWith(
			2,
			'consume_server_rate_limits',
			expect.objectContaining({
				p_action: 'radiograph_original_access_by_user',
				p_windows: [{ limit_count: 300, window_seconds: 3600 }]
			})
		);
		expect(rpc).toHaveBeenNthCalledWith(
			3,
			'consume_server_rate_limits',
			expect.objectContaining({
				p_action: 'radiograph_trash_by_user',
				p_windows: [{ limit_count: 30, window_seconds: 60 }]
			})
		);
		expect(rpc).toHaveBeenNthCalledWith(
			4,
			'consume_server_rate_limits',
			expect.objectContaining({
				p_action: 'radiograph_restore_by_user',
				p_windows: [{ limit_count: 30, window_seconds: 60 }]
			})
		);
	});
});

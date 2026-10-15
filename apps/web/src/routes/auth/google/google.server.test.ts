import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	clearSupabaseOAuthCookies: vi.fn(),
	createSupabaseOAuthClient: vi.fn(),
	enforceRateLimitsFailOpen: vi.fn(),
	googleAuthRateLimitRules: vi.fn((ip: string) => [{ action: 'signup_google_by_ip', subject: ip }])
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$lib/server/supabase', () => ({
	clearSupabaseOAuthCookies: mocks.clearSupabaseOAuthCookies,
	createSupabaseOAuthClient: mocks.createSupabaseOAuthClient
}));
vi.mock('$lib/server/rate-limits', () => ({
	enforceRateLimitsFailOpen: mocks.enforceRateLimitsFailOpen,
	googleAuthRateLimitRules: mocks.googleAuthRateLimitRules,
	RateLimitExceededError: class RateLimitExceededError extends Error {}
}));

const { GET } = await import('./+server');

const makeEvent = (url: string) => ({
	url: new URL(url),
	cookies: {
		set: vi.fn(),
		delete: vi.fn()
	},
	fetch: vi.fn(),
	getClientAddress: vi.fn(() => '203.0.113.10')
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.env.DEMO_MODE = undefined;
	mocks.enforceRateLimitsFailOpen.mockResolvedValue(undefined);
	mocks.createSupabaseOAuthClient.mockResolvedValue({
		auth: {
			signInWithOAuth: vi.fn(async () => ({
				data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test' },
				error: null
			}))
		}
	});
});

describe('/auth/google OAuth start', () => {
	it('redirige al proveedor con OAuth iniciado del lado servidor', async () => {
		const event = makeEvent('https://app.test/auth/google?mode=login');

		const response = await GET(event as never);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			'https://accounts.google.com/o/oauth2/v2/auth?client_id=test'
		);

		expect(mocks.clearSupabaseOAuthCookies).toHaveBeenCalledWith(event.cookies);
		expect(mocks.enforceRateLimitsFailOpen).toHaveBeenCalledWith(
			[{ action: 'signup_google_by_ip', subject: '203.0.113.10' }],
			expect.objectContaining({
				fetchImpl: event.fetch,
				logContext: 'No se pudo aplicar el control de intentos de Google Auth'
			})
		);
		const client = await mocks.createSupabaseOAuthClient.mock.results[0].value;
		expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
			provider: 'google',
			options: {
				redirectTo: 'https://app.test/auth/callback',
				scopes: 'openid email profile',
				queryParams: { prompt: 'select_account' }
			}
		});
	});

	it('rechaza registro con Google si faltan términos aceptados', async () => {
		const response = await GET(
			makeEvent('https://app.test/auth/google?mode=register&accepted_terms=false') as never
		);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			'https://app.test/login?auth_error=google_terms'
		);

		expect(mocks.createSupabaseOAuthClient).not.toHaveBeenCalled();
	});

	it('redirige al login con error si Supabase no devuelve URL OAuth', async () => {
		mocks.createSupabaseOAuthClient.mockResolvedValue({
			auth: {
				signInWithOAuth: vi.fn(async () => ({ data: { url: null }, error: new Error('bad') }))
			}
		});

		const response = await GET(makeEvent('https://app.test/auth/google?mode=login') as never);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			'https://app.test/login?auth_error=google_start'
		);
	});

	it('redirige al login en vez de arrojar 500 si falta la configuración OAuth', async () => {
		mocks.createSupabaseOAuthClient.mockRejectedValueOnce(
			new Error('Faltan variables de entorno de Supabase')
		);
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await GET(makeEvent('https://app.test/auth/google?mode=login') as never);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			'https://app.test/login?auth_error=google_start'
		);
		expect(log).toHaveBeenCalledWith(
			'No se pudo conectar con Supabase Auth para iniciar Google OAuth',
			expect.any(Error)
		);
		log.mockRestore();
	});

	it('bloquea Google únicamente cuando el límite real fue alcanzado', async () => {
		const { RateLimitExceededError } = await import('$lib/server/rate-limits');
		mocks.enforceRateLimitsFailOpen.mockRejectedValueOnce(new RateLimitExceededError('límite', 60));

		const response = await GET(makeEvent('https://app.test/auth/google?mode=login') as never);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			'https://app.test/login?auth_error=google_rate_limited'
		);
		expect(mocks.createSupabaseOAuthClient).not.toHaveBeenCalled();
	});
});

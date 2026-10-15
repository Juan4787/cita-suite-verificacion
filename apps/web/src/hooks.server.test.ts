import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {
		ODONTO_SUPABASE_URL: 'https://odonto.supabase.co',
		ADMIN_SUPABASE_URL: 'https://admin.supabase.co'
	} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn(),
	getEmailFromAccessToken: vi.fn(),
	getModuleEntryRoute: vi.fn(() => '/odonto'),
	isJwtExpired: vi.fn(),
	isMasterEmail: vi.fn()
}));

vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/business', () => ({ ACTIVE_BUSINESS_COOKIE: 'active-business-id' }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getEmailFromAccessToken: mocks.getEmailFromAccessToken,
	getModuleEntryRoute: mocks.getModuleEntryRoute,
	isJwtExpired: mocks.isJwtExpired,
	isMasterEmail: mocks.isMasterEmail
}));

const { handle } = await import('./hooks.server');

const makeEvent = () => {
	const cookieValues: Record<string, string> = {
		'sb-module': 'odonto',
		'sb-access-token': 'forged-token',
		'sb-refresh-token': 'refresh-token'
	};
	return {
		url: new URL('https://app.test/odonto'),
		locals: {},
		fetch: vi.fn(async () => new Response('{}')),
		cookies: {
			get: vi.fn((key: string) => cookieValues[key]),
			set: vi.fn(),
			delete: vi.fn()
		}
	};
};

describe('hooks auth validation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isJwtExpired.mockReturnValue(false);
		mocks.getEmailFromAccessToken.mockReturnValue('owner@test.com');
		mocks.isMasterEmail.mockReturnValue(false);
	});

	it('rechaza un access token no vencido si Supabase Auth no lo valida', async () => {
		const event = makeEvent();
		const resolve = vi.fn(async () => new Response('ok'));
		mocks.createSupabaseServerClient.mockResolvedValue({
			auth: {
				getUser: vi.fn(async () => ({ data: { user: null }, error: new Error('invalid') }))
			}
		});

		await expect(handle({ event, resolve } as never)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});

		expect(resolve).not.toHaveBeenCalled();
		expect(event.cookies.delete).toHaveBeenCalledWith('sb-module', { path: '/' });
		expect(event.cookies.delete).toHaveBeenCalledWith('sb-access-token', { path: '/' });
		expect(event.cookies.delete).toHaveBeenCalledWith('sb-refresh-token', { path: '/' });
		expect(event.cookies.delete).toHaveBeenCalledWith('active-business-id', { path: '/' });
	});

	it('conserva la sesión y devuelve 503 cuando Auth está temporalmente caído', async () => {
		const event = makeEvent();
		const resolve = vi.fn(async () => new Response('ok'));
		const outage = Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' });
		mocks.createSupabaseServerClient.mockResolvedValue({
			auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: outage })) }
		});

		const response = await handle({ event, resolve } as never);

		expect(response).toBeInstanceOf(Response);
		expect((response as Response).status).toBe(503);
		expect((response as Response).headers.get('cache-control')).toBe('no-store');
		expect(await (response as Response).text()).toContain('Tus datos no se modificaron');
		expect(resolve).not.toHaveBeenCalled();
		expect(event.cookies.delete).not.toHaveBeenCalled();
	});

	it('trata un 429 de Auth como transitorio y no borra cookies', async () => {
		const event = makeEvent();
		const resolve = vi.fn(async () => new Response('ok'));
		const rateLimit = Object.assign(new Error('too many requests'), { status: 429 });
		mocks.createSupabaseServerClient.mockResolvedValue({
			auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: rateLimit })) }
		});

		const response = await handle({ event, resolve } as never);

		expect((response as Response).status).toBe(503);
		expect(event.cookies.delete).not.toHaveBeenCalled();
	});

	it('vuelve a validar Auth en cada request para respetar la revocación inmediata', async () => {
		const firstEvent = makeEvent();
		const secondEvent = makeEvent();
		(firstEvent.cookies.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
			key === 'sb-access-token'
				? 'valid-token-for-cache-test'
				: key === 'sb-refresh-token'
					? 'refresh-token'
					: key === 'sb-module'
						? 'odonto'
						: undefined
		);
		(secondEvent.cookies.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
			key === 'sb-access-token'
				? 'valid-token-for-cache-test'
				: key === 'sb-refresh-token'
					? 'refresh-token'
					: key === 'sb-module'
						? 'odonto'
						: undefined
		);
		const getUser = vi.fn(async () => ({
			data: { user: { id: 'user-1' } },
			error: null
		}));
		mocks.createSupabaseServerClient.mockResolvedValue({ auth: { getUser } });
		const resolve = vi.fn(async () => new Response('ok'));

		await handle({ event: firstEvent, resolve } as never);
		await handle({ event: secondEvent, resolve } as never);

		expect(getUser).toHaveBeenCalledTimes(2);
		expect(resolve).toHaveBeenCalledTimes(2);
	});

	it('aplica headers de seguridad y cache privado sin pisar contratos de rutas', async () => {
		const event = makeEvent();
		event.url = new URL('https://app.test/login');
		(event.cookies.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		const response = new Response('<html></html>', {
			headers: {
				'content-type': 'text/html',
				'x-sveltekit-page': 'true',
				'referrer-policy': 'no-referrer',
				'cache-control': 'no-store'
			}
		});
		const resolve = vi.fn(async () => response);

		await handle({ event, resolve } as never);

		expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		expect(response.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('no deja HTML SSR sin cache-control aunque no tenga sesión', async () => {
		const event = makeEvent();
		event.url = new URL('https://app.test/login');
		(event.cookies.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		const response = new Response('<html></html>', {
			headers: { 'content-type': 'text/html', 'x-sveltekit-page': 'true' }
		});
		const resolve = vi.fn(async () => response);

		await handle({ event, resolve } as never);

		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});
});

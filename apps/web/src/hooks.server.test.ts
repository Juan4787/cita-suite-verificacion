import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {
		ODONTO_SUPABASE_URL: 'https://odonto.supabase.co',
		ADMIN_SUPABASE_URL: 'https://admin.supabase.co'
	} as Record<string, string | undefined>,
	publicEnv: { PUBLIC_ODONTO_SUPABASE_URL: 'https://odonto.supabase.co' } as Record<string, string | undefined>
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
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));
vi.mock('$lib/server/access/public/business', () => ({ ACTIVE_BUSINESS_COOKIE: 'active-business-id' }));
vi.mock('$lib/server/platform/supabase', async (importOriginal) => ({
	parseModule: (await importOriginal<typeof import('$lib/server/platform/supabase')>()).parseModule,
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getEmailFromAccessToken: mocks.getEmailFromAccessToken,
	getModuleEntryRoute: mocks.getModuleEntryRoute,
	isJwtExpired: mocks.isJwtExpired,
	isMasterEmail: mocks.isMasterEmail
}));

const { handle, handleError } = await import('./hooks.server');

const makeEvent = () => {
	const cookieValues: Record<string, string> = {
		'sb-module': 'odonto',
		'sb-access-token': 'forged-token',
		'sb-refresh-token': 'refresh-token'
	};
	return {
		url: new URL('https://app.test/odonto'),
		request: new Request('https://app.test/odonto', { headers: { accept: 'application/json' } }),
		isDataRequest: false,
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

	it('keeps public tokens and internal authentication independent of stale user cookies', async () => {
		mocks.createSupabaseServerClient.mockRejectedValue(new Error('invalid old user session'));
		for (const path of ['/reservar/clinic', '/embed/v1/integration', '/turno/token/push', '/api/public/contacto/integration', '/internal/jobs/send-push-reminders', '/api/mercadopago/webhook', '/oauth/google-calendar/callback']) {
			const event = makeEvent();
			event.url = new URL('https://app.test' + path);
			const resolve = vi.fn(async () => new Response('independent authorization'));
			const response = await handle({ event, resolve } as never);
			expect(response.status).toBe(200);
			expect(resolve).toHaveBeenCalledOnce();
			expect(event.locals).toMatchObject({ auth: null, verifiedUser: null });
			expect(event.cookies.delete).not.toHaveBeenCalled();
		}
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
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

	it('renders document recovery without authenticating the route, clearing cookies or weakening CSP', async () => {
		const event = makeEvent();
		event.request = new Request(event.url, { headers: { accept: 'text/html' } });
		const resolve = vi.fn();
		mocks.createSupabaseServerClient.mockResolvedValue({ auth: {
			getUser: vi.fn(async () => ({ data: { user: null }, error: Object.assign(new Error('private provider data'), { status: 503 }) }))
		} });
		const response = await handle({ event, resolve } as never);
		expect(response.status).toBe(503);
		expect(response.headers.get('content-type')).toContain('text/html');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('retry-after')).toBe('10');
		expect(response.headers.get('content-security-policy')).toMatch(/style-src 'sha256-[A-Za-z0-9+/=]+'/);
		expect(response.headers.get('content-security-policy')).not.toContain('unsafe-inline');
		const html = await response.text();
		expect(html).toContain('<a href="">Volver a intentar</a>');
		expect(html).not.toMatch(/private provider data|<script|https?:\/\//);
		expect(resolve).not.toHaveBeenCalled();
		expect(event.cookies.delete).not.toHaveBeenCalled();
		expect(event.locals).toMatchObject({ verifiedUser: null });
	});

	it('does not turn a data request into a styled document or expose unexpected provider errors', async () => {
		const event = makeEvent(); event.isDataRequest = true;
		event.request = new Request(event.url, { headers: { accept: 'text/html' } });
		mocks.createSupabaseServerClient.mockResolvedValue({ auth: {
			getUser: vi.fn(async () => ({ data: { user: null }, error: { status: 503 } }))
		} });
		const response = await handle({ event, resolve: vi.fn() } as never);
		expect(response.status).toBe(503);
		expect(response.headers.get('content-type')).toContain('text/plain');
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const result = await handleError({ error: { code: '53300', message: 'private clinical data', details: 'signed-token' } } as never);
			expect(result).toEqual({ message: 'No pudimos completar la acción. Volvé a intentar en unos momentos.' });
			expect(log.mock.calls).toEqual([['request.unexpected_failure', { sqlState: '53300' }]]);
		} finally { log.mockRestore(); }
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

	it('expone la identidad de Auth y no usa un correo decodificado para el acceso maestro', async () => {
		const event = makeEvent();
		event.url = new URL('https://app.test/odonto/maestro');
		mocks.getEmailFromAccessToken.mockReturnValue('master@example.test');
		mocks.isMasterEmail.mockImplementation(email => email === 'master@example.test');
		mocks.createSupabaseServerClient.mockResolvedValue({ auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-id', email: 'professional@example.test' } }, error: null })
		} });
		const resolve = vi.fn();
		await expect(handle({ event, resolve } as never)).rejects.toMatchObject({ status: 303, location: '/odonto' });
		expect(event.locals).toMatchObject({ verifiedUser: { id: 'verified-id', email: 'professional@example.test' } });
		expect(mocks.isMasterEmail).toHaveBeenCalledWith('professional@example.test');
		expect(mocks.getEmailFromAccessToken).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('conserva la identidad verificada después de refrescar la sesión', async () => {
		const event = makeEvent();
		mocks.isJwtExpired.mockReturnValue(true);
		const user = { id: 'refreshed-id', email: 'owner@example.test' };
		mocks.createSupabaseServerClient.mockResolvedValue({ auth: {
			refreshSession: vi.fn().mockResolvedValue({ data: { user,
				session: { access_token: 'new-access', refresh_token: 'new-refresh', user } }, error: null })
		} });
		await handle({ event, resolve: vi.fn(async () => new Response('ok')) } as never);
		expect(event.locals).toMatchObject({ verifiedUser: user, auth: { access_token: 'new-access', refresh_token: 'new-refresh' } });
	});

	it.each([['GET', 'request'], ['HEAD', 'request'], ['POST', 'fresh']])(
		'a %s request lets its loads share one membership read only when it cannot write', async (method, expected) => {
		const event = { ...makeEvent(), request: new Request('https://app.test/odonto/agenda', { method }) };
		event.url = new URL('https://app.test/odonto/agenda');
		mocks.createSupabaseServerClient.mockResolvedValue({ auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'owner-id', email: 'owner@example.test' } }, error: null })
		} });
		await handle({ event, resolve: vi.fn(async () => new Response('ok')) } as never);
		expect(event.locals).toMatchObject({ membershipCache: expected });
	});

	it.each(['GET', 'POST'])('el módulo administrativo sigue inaccesible por %s antes de resolver una ruta', async (method) => {
		const event = { ...makeEvent(), request: new Request('https://app.test/administrativo/expedientes', { method }) };
		event.url = new URL('https://app.test/administrativo/expedientes');
		mocks.createSupabaseServerClient.mockResolvedValue({ auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'owner-id', email: 'owner@example.test' } }, error: null })
		} });
		const resolve = vi.fn();
		await expect(handle({ event, resolve } as never)).rejects.toMatchObject({ status: 303, location: '/odonto' });
		expect(resolve).not.toHaveBeenCalled();
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

	it('agrega a la política renderizada sólo el proyecto Supabase configurado', async () => {
		const event = makeEvent();
		event.url = new URL('https://app.test/login');
		(event.cookies.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		const response = new Response('<html></html>', {
			headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self'" }
		});

		await handle({ event, resolve: vi.fn(async () => response) } as never);

		expect(response.headers.get('content-security-policy')).toBe(
			"default-src 'self'; connect-src 'self' https://odonto.supabase.co wss://odonto.supabase.co; img-src 'self' https://odonto.supabase.co"
		);
	});
});

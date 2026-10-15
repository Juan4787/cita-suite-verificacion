import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn()
}));

vi.mock('$lib/server/business', () => ({ ACTIVE_BUSINESS_COOKIE: 'active-business-id' }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient
}));

const { GET, POST } = await import('./+server');

const makeCookies = () => ({
	delete: vi.fn()
});

const makeEvent = (auth: { module: 'odonto'; access_token: string; refresh_token: string } | null) => ({
	cookies: makeCookies(),
	locals: { auth },
	fetch: vi.fn()
});

const redirectLocation = async (promise: Promise<unknown>) => {
	try {
		await promise;
		throw new Error('expected redirect');
	} catch (error) {
		return {
			status: (error as { status?: number }).status,
			location: (error as { location?: string }).location
		};
	}
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createSupabaseServerClient.mockResolvedValue({
		auth: { admin: { signOut: vi.fn().mockResolvedValue({ error: null }) } }
	});
});

describe('logout server-side', () => {
	it('revoca globalmente la sesión antes de limpiar todas las cookies', async () => {
		const event = makeEvent({ module: 'odonto', access_token: 'access', refresh_token: 'refresh' });
		const result = await redirectLocation(Promise.resolve(POST(event as never)));
		const supabase = await mocks.createSupabaseServerClient.mock.results[0].value;

		expect(result).toEqual({ status: 303, location: '/login' });
		expect(mocks.createSupabaseServerClient).toHaveBeenCalledWith('odonto', event.locals.auth, event.fetch);
		expect(supabase.auth.admin.signOut).toHaveBeenCalledWith('access', 'global');
		expect(event.cookies.delete).toHaveBeenCalledTimes(4);
		expect(event.cookies.delete).toHaveBeenCalledWith('active-business-id', { path: '/' });
	});

	it('no hace ningún efecto con GET, para que prefetch y crawlers no cierren sesiones', async () => {
		const event = makeEvent({ module: 'odonto', access_token: 'access', refresh_token: 'refresh' });
		const response = await GET(event as never);

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(event.cookies.delete).not.toHaveBeenCalled();
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
	});

	it('informa cuando no puede confirmar la revocación remota, sin conservar cookies', async () => {
		const signOut = vi.fn().mockResolvedValue({ error: { status: 503 } });
		mocks.createSupabaseServerClient.mockResolvedValueOnce({ auth: { admin: { signOut } } });
		const event = makeEvent({ module: 'odonto', access_token: 'access', refresh_token: 'refresh' });
		const result = await redirectLocation(Promise.resolve(POST(event as never)));

		expect(result).toEqual({ status: 303, location: '/login?auth_error=logout_failed' });
		expect(signOut).toHaveBeenCalledWith('access', 'global');
		expect(event.cookies.delete).toHaveBeenCalledTimes(4);
	});

	it('limpia la sesión local si ya no había autenticación', async () => {
		const event = makeEvent(null);
		const result = await redirectLocation(Promise.resolve(POST(event as never)));

		expect(result).toEqual({ status: 303, location: '/login' });
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
		expect(event.cookies.delete).toHaveBeenCalledTimes(4);
	});
});

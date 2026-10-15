import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	clearSupabaseOAuthCookies: vi.fn(),
	createSupabaseOAuthClient: vi.fn(),
	getModuleEntryRoute: vi.fn(() => '/odonto/agenda'),
	isMasterEmail: vi.fn()
}));

vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/server/supabase', () => ({
	clearSupabaseOAuthCookies: mocks.clearSupabaseOAuthCookies,
	createSupabaseOAuthClient: mocks.createSupabaseOAuthClient,
	getModuleEntryRoute: mocks.getModuleEntryRoute,
	isMasterEmail: mocks.isMasterEmail
}));

const { GET } = await import('./+server');

const createCookies = () => {
	const calls: Array<{ name: string; value?: string }> = [];
	return {
		calls,
		cookies: {
			set: vi.fn((name: string, value: string) => calls.push({ name, value })),
			delete: vi.fn((name: string) => calls.push({ name }))
		}
	};
};

const makeEvent = (url: string, cookies: ReturnType<typeof createCookies>['cookies']) => ({
	url: new URL(url),
	cookies,
	fetch: vi.fn()
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.isMasterEmail.mockReturnValue(false);
	mocks.createSupabaseOAuthClient.mockResolvedValue({
		auth: {
			exchangeCodeForSession: vi.fn(async () => ({
				data: {
					session: { access_token: 'access', refresh_token: 'refresh' },
					user: { email: 'cliente@example.com' }
				},
				error: null
			}))
		}
	});
});

describe('/auth/callback Google OAuth', () => {
	it('setea cookies de app aunque el email no esté prehabilitado', async () => {
		const { cookies, calls } = createCookies();

		await expect(
			GET(makeEvent('https://app.test/auth/callback?code=ok', cookies) as never)
		).rejects.toMatchObject({ status: 303, location: '/odonto/agenda' });

		expect(mocks.clearSupabaseOAuthCookies).toHaveBeenCalledWith(cookies);
		expect(calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'sb-module', value: 'odonto' }),
				expect.objectContaining({ name: 'sb-access-token', value: 'access' }),
				expect.objectContaining({ name: 'sb-refresh-token', value: 'refresh' })
			])
		);
	});

	it('setea las cookies propias de la app cuando el email está habilitado', async () => {
		const { cookies, calls } = createCookies();

		await expect(
			GET(makeEvent('https://app.test/auth/callback?code=ok', cookies) as never)
		).rejects.toMatchObject({ status: 303, location: '/odonto/agenda' });

		expect(calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'sb-module', value: 'odonto' }),
				expect.objectContaining({ name: 'sb-access-token', value: 'access' }),
				expect.objectContaining({ name: 'sb-refresh-token', value: 'refresh' })
			])
		);
	});
});

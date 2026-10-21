import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	getEmailFromAccessToken: vi.fn(),
	getUserIdFromAccessToken: vi.fn(),
	listUsers: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	getEmailFromAccessToken: mocks.getEmailFromAccessToken,
	getUserIdFromAccessToken: mocks.getUserIdFromAccessToken,
	isMasterEmail: (email?: string | null) => email === 'master@example.test'
}));

const { load } = await import('./+page.server');

// A query builder: every chained call returns it, and awaiting it gives `result`.
const query = (result: unknown) => {
	const builder: object = new Proxy({}, {
		get: (_target, key) =>
			key === 'then'
				? (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
				: () => builder
	});
	return builder;
};

const failure = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };

const tables = (overrides: Record<string, unknown> = {}) => {
	mocks.createSupabaseAdminClient.mockResolvedValue({
		from: (table: string) => query(overrides[table] ?? { data: [], error: null }),
		auth: { admin: { listUsers: mocks.listUsers } }
	});
};

const event = (verifiedEmail: string) =>
	({
		locals: { auth: { access_token: 'test-token' }, verifiedUser: { id: 'user-1', email: verifiedEmail } },
		fetch: vi.fn()
	}) as never;

describe('master panel load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getEmailFromAccessToken.mockReturnValue('master@example.test');
		mocks.getUserIdFromAccessToken.mockReturnValue('user-1');
		mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
	});

	it('opens for the master identity Auth verified, not for a token that only claims it', async () => {
		tables();
		await expect(load(event('professional@example.test'))).rejects.toMatchObject({ status: 303 });
	});

	it('fails explicitly instead of listing the practices without their commercial state', async () => {
		tables({ business_subscriptions: failure });
		const result = (await load(event('master@example.test'))) as { loadError: string | null };
		expect(result.loadError).toBeTruthy();
	});

	it('fails explicitly instead of listing the accounts without their emails', async () => {
		tables();
		mocks.listUsers.mockResolvedValue({ data: null, error: { message: 'Auth unavailable' } });
		const result = (await load(event('master@example.test'))) as { loadError: string | null };
		expect(result.loadError).toBeTruthy();
	});
});

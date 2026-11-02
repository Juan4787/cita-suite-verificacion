import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	createSupabaseServerClient: vi.fn(),
	endAccountAssistance: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	isMasterEmail: (email?: string | null) => email === 'master@example.test'
}));
vi.mock('$lib/server/access/public/account-assistance', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/access/public/account-assistance')>()),
	endAccountAssistance: mocks.endAccountAssistance
}));

const { actions, load } = await import('./+page.server');

const BUSINESS_ID = '44444444-4444-4444-8444-444444444444';
const GRANT_ID = '55555555-5555-4555-8555-555555555555';

const event = (formEntries: Record<string, string>, email = 'master@example.test') =>
	({
		locals: { auth: { access_token: 'token', refresh_token: 'r' }, verifiedUser: { id: 'master-user-id', email } },
		fetch: vi.fn(),
		request: new Request('https://app.test/odonto/maestro', { method: 'POST', body: new URLSearchParams(formEntries) })
	}) as never;

const entries = (overrides: Record<string, string> = {}) => ({
	confirmed: '1',
	grant_id: GRANT_ID,
	business_id: BUSINESS_ID,
	business_name: 'Consultorio Natalia Frutos',
	...overrides
});

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

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createSupabaseServerClient.mockResolvedValue({ rpc: vi.fn() });
	mocks.endAccountAssistance.mockResolvedValue({ id: GRANT_ID });
});

describe('master panel: ending an assistance', () => {
	it('ends it with the master own session, so the database checks it is the support user of the grant', async () => {
		const result = (await actions.end_assistance(event(entries()))) as { success: boolean; message: string };

		const session = await mocks.createSupabaseServerClient.mock.results[0].value;
		expect(mocks.createSupabaseServerClient).toHaveBeenCalledWith('odonto', expect.objectContaining({ access_token: 'token' }), expect.any(Function));
		expect(mocks.endAccountAssistance).toHaveBeenCalledWith({ supabase: session, businessId: BUSINESS_ID, grantId: GRANT_ID });
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
		expect(result).toEqual({ success: true, message: 'Terminaste la ayuda de Consultorio Natalia Frutos: ya no podés entrar a su cuenta.' });
	});

	it('ends nothing without the confirmation or the grant', async () => {
		for (const form of [entries({ confirmed: '' }), entries({ grant_id: '' }), entries({ business_id: 'not-a-uuid' })]) {
			const result = (await actions.end_assistance(event(form))) as { status: number };
			expect(result.status).toBe(400);
		}
		expect(mocks.endAccountAssistance).not.toHaveBeenCalled();
	});

	it('is only for the master', async () => {
		await expect(actions.end_assistance(event(entries(), 'owner@example.test'))).rejects.toMatchObject({ status: 303 });
		expect(mocks.endAccountAssistance).not.toHaveBeenCalled();
	});

	it('says why the database refused instead of reporting it ended', async () => {
		mocks.endAccountAssistance.mockRejectedValue({ message: 'ACCOUNT_ASSISTANCE_NOT_ACTIVE' });

		const result = (await actions.end_assistance(event(entries()))) as { status: number; data: { message: string } };

		expect(result.status).toBe(409);
		expect(result.data.message).toBe('La ayuda ya no está activa.');
	});
});

describe('master panel: active assistance list', () => {
	it('lists each active assistance with its duration', async () => {
		const grant = {
			id: GRANT_ID,
			business_id: BUSINESS_ID,
			requested_by_user_id: 'owner-1',
			support_user_id: 'master-user-id',
			kind: 'initial_setup',
			starts_at: '2026-11-01T13:15:00.000Z',
			expires_at: '2026-11-08T13:15:00.000Z',
			revoked_at: null,
			business: { id: BUSINESS_ID, name: 'Consultorio Natalia Frutos', slug: 'natalia-frutos' }
		};
		const tables: Record<string, unknown> = {
			businesses: { data: [{ id: BUSINESS_ID, name: 'Consultorio Natalia Frutos', slug: 'natalia-frutos', email: null, timezone: 'America/Argentina/Buenos_Aires', is_active: true }], error: null },
			account_assistance_grants: { data: [grant], error: null }
		};
		mocks.createSupabaseAdminClient.mockResolvedValue({
			from: (table: string) => query(tables[table] ?? { data: [], error: null }),
			auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })) } }
		});

		const result = (await load({
			locals: { auth: { access_token: 'token' }, verifiedUser: { id: 'master-user-id', email: 'master@example.test' } },
			fetch: vi.fn()
		} as never)) as { assistance: Array<Record<string, unknown>>; loadError: string | null };

		expect(result.loadError).toBeNull();
		expect(result.assistance).toEqual([
			expect.objectContaining({ id: GRANT_ID, businessId: BUSINESS_ID, kind: 'initial_setup', expiresAt: '2026-11-08T13:15:00.000Z' })
		]);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveActiveBusiness: vi.fn(), from: vi.fn(), rpc: vi.fn(), createSupabaseAdminClient: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/business', () => ({
	BUSINESS_INDUSTRIES: ['odontology', 'other'],
	isBusinessIndustry: () => true,
	normalizeSlug: (value: string) => value.trim().toLowerCase(),
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	createSupabaseServerClient: vi.fn(async () => ({ from: mocks.from, rpc: mocks.rpc }))
}));

const { load, actions } = await import('./+page.server');

// A query builder: every chained call returns it, and awaiting it gives `result`.
const query = (result: unknown = { data: [], count: 0, error: null }) => {
	const builder: object = new Proxy({}, {
		get: (_target, key) =>
			key === 'then'
				? (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
				: () => builder
	});
	return builder;
};

const event = () =>
	({
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() }
	}) as never;

describe('practice settings load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveActiveBusiness.mockResolvedValue({ business: { id: 'business-1' }, role: 'owner' });
		mocks.from.mockImplementation(() => query());
	});

	it('loads the practice without reading the booking readiness the page no longer shows', async () => {
		const result = (await load(event())) as { context: unknown };
		expect(result.context).toEqual({ business: { id: 'business-1' }, role: 'owner' });
		expect(mocks.from).not.toHaveBeenCalled();
	});
});

describe('practice settings save', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveActiveBusiness.mockResolvedValue({
			business: { id: 'business-1', public_booking_enabled: false }, role: 'admin', canManage: true, assistance: { grantId: 'grant-1' }
		});
		mocks.rpc.mockReturnValue(query({ data: true, error: null }));
		mocks.from.mockImplementation(() => query({ data: { id: 'business-1' }, error: null }));
		// Were the service role used, it would save too: the test checks which client does.
		mocks.createSupabaseAdminClient.mockResolvedValue({ from: () => query({ data: { id: 'business-1' }, error: null }) });
	});

	it('saves an assistance session under its own rules, never with the service role', async () => {
		const form = new FormData();
		form.set('name', 'Consultorio'); form.set('slug', 'consultorio'); form.set('industry', 'odontology');
		form.set('timezone', 'America/Argentina/Buenos_Aires');
		const result = await actions.update_business({
			request: new Request('http://localhost/odonto/configuracion/negocio', { method: 'POST', body: form }),
			locals: { auth: { access_token: 'test-token' } }, fetch: vi.fn(), cookies: { get: vi.fn() }
		} as never);
		expect(result).toEqual({ success: true });
		expect(mocks.from).toHaveBeenCalledWith('businesses');
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
	});

	it('does not accept a public link name shaped like an identifier, which the booking link would read as one', async () => {
		const form = new FormData();
		form.set('name', 'Consultorio'); form.set('slug', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); form.set('industry', 'odontology');
		form.set('timezone', 'America/Argentina/Buenos_Aires');
		const result = await actions.update_business({
			request: new Request('http://localhost/odonto/configuracion/negocio', { method: 'POST', body: form }),
			locals: { auth: { access_token: 'test-token' } }, fetch: vi.fn(), cookies: { get: vi.fn() }
		} as never);
		expect(result).toMatchObject({ status: 400 });
		expect(mocks.from).not.toHaveBeenCalled();
	});
});

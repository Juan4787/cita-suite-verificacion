import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveActiveBusiness: vi.fn(), from: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/business', () => ({
	BUSINESS_INDUSTRIES: ['odontology', 'other'],
	isBusinessIndustry: vi.fn(),
	normalizeSlug: vi.fn(),
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: vi.fn(),
	createSupabaseServerClient: vi.fn(async () => ({ from: mocks.from }))
}));

const { load } = await import('./+page.server');

// A query builder: every chained call returns it, and awaiting it gives an empty answer.
const query = () => {
	const builder: object = new Proxy({}, {
		get: (_target, key) =>
			key === 'then'
				? (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve)
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
		mocks.from.mockImplementation(query);
	});

	it('loads the practice without reading the booking readiness the page no longer shows', async () => {
		const result = (await load(event())) as { context: unknown };
		expect(result.context).toEqual({ business: { id: 'business-1' }, role: 'owner' });
		expect(mocks.from).not.toHaveBeenCalled();
	});
});

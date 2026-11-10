import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveActiveBusiness: vi.fn(), from: vi.fn(), rpc: vi.fn(), createSupabaseAdminClient: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_SITE_URL: 'https://app.cita-suite.com.ar' } }));
vi.mock('$lib/server/access/public/business', async () => ({
	BUSINESS_INDUSTRIES: ['odontology', 'other'],
	isBusinessIndustry: () => true,
	normalizeSlug: (await import('$lib/booking/booking-link')).normalizeSlug,
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	createSupabaseServerClient: vi.fn(async () => ({ from: mocks.from, rpc: mocks.rpc }))
}));

const { load, actions } = await import('./+page.server');

// A query builder: every chained call returns it, and awaiting it gives `result`. Each call is
// recorded with its arguments, so a test can read what was selected or saved.
const calls: { method: string; args: unknown[] }[] = [];
const query = (result: unknown = { data: [], count: 0, error: null }) => {
	const builder: object = new Proxy({}, {
		get: (_target, key) =>
			key === 'then'
				? (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
				: (...args: unknown[]) => {
						calls.push({ method: String(key), args });
						return builder;
					}
	});
	return builder;
};
const saved = () => calls.find((call) => call.method === 'update')?.args[0] as Record<string, unknown> | undefined;

const event = () =>
	({
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() }
	}) as never;

describe('practice settings load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		calls.length = 0;
		mocks.resolveActiveBusiness.mockResolvedValue({ business: { id: 'business-1' }, role: 'owner' });
		mocks.from.mockImplementation(() => query({ data: { slug_follows_name: true }, error: null }));
	});

	it('loads the practice and whether its booking link follows the name, without reading the booking readiness the page no longer shows', async () => {
		const result = (await load(event())) as { context: unknown; slugFollowsName: boolean; bookingOrigin: string };
		expect(result.context).toEqual({ business: { id: 'business-1' }, role: 'owner' });
		expect(result).toMatchObject({ slugFollowsName: true, bookingOrigin: 'https://app.cita-suite.com.ar' });
		expect(mocks.from.mock.calls).toEqual([['businesses']]);
		expect(calls.find((call) => call.method === 'select')?.args).toEqual(['slug_follows_name']);
	});

	it('does not show the page when it cannot tell whether the link follows the name, which saving would change', async () => {
		mocks.from.mockImplementation(() => query({ data: null, error: { message: 'synthetic failure' } }));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
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
		calls.length = 0;
	});

	const submit = (slug: string) => {
		const form = new FormData();
		form.set('name', 'Consultorio Ramírez'); form.set('slug', slug); form.set('industry', 'odontology');
		form.set('timezone', 'America/Argentina/Buenos_Aires');
		return actions.update_business({
			request: new Request('http://localhost/odonto/configuracion/negocio', { method: 'POST', body: form }),
			locals: { auth: { access_token: 'test-token' } }, fetch: vi.fn(), cookies: { get: vi.fn() }
		} as never);
	};

	it('saves an empty booking address as following the name, without writing an address', async () => {
		await expect(submit('   ')).resolves.toEqual({ success: true });
		expect(saved()).toMatchObject({ name: 'Consultorio Ramírez', slug_follows_name: true });
		expect(saved()).not.toHaveProperty('slug');
	});

	it('saves a typed booking address as the practice\'s choice, normalized', async () => {
		await expect(submit('Turnos Ramírez')).resolves.toEqual({ success: true });
		expect(saved()).toMatchObject({ slug: 'turnos-ramirez', slug_follows_name: false });
	});

	it('refuses an address without letters or numbers instead of turning it into the name\'s', async () => {
		await expect(submit('¡¡--!!')).resolves.toMatchObject({ status: 400 });
		expect(saved()).toBeUndefined();
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

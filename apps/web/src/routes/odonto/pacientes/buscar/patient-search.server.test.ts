import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getOdontoContext: vi.fn(),
	from: vi.fn(),
	select: vi.fn(),
	eq: vi.fn(),
	is: vi.fn(),
	or: vi.fn(),
	order: vi.fn(),
	limit: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/odonto-context', () => ({
	getOdontoContext: mocks.getOdontoContext
}));

const { GET } = await import('./+server');

const businessId = '00000000-0000-4000-8000-000000000001';
const builder = {
	select: mocks.select,
	eq: mocks.eq,
	is: mocks.is,
	or: mocks.or,
	order: mocks.order,
	limit: mocks.limit
};

const makeEvent = (query = 'Maria') =>
	({
		url: new URL(`http://localhost/odonto/pacientes/buscar?q=${encodeURIComponent(query)}`),
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() }
	}) as any;

describe('patient search endpoint used by the agenda wizard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const method of [mocks.select, mocks.eq, mocks.is, mocks.or, mocks.order]) {
			method.mockReturnValue(builder);
		}
		mocks.limit.mockResolvedValue({ data: [], error: null });
		mocks.from.mockReturnValue(builder);
		mocks.getOdontoContext.mockResolvedValue({
			supabase: { from: mocks.from },
			business: { business: { id: businessId } }
		});
	});

	it('matches a name typed without the accents stored in the patient name', async () => {
		const response = await GET(makeEvent('Maria'));

		expect(response.status).toBe(200);
		expect(mocks.or).toHaveBeenCalledWith(
			expect.stringContaining('search_name_normalized.ilike.%maria%')
		);
	});

	it('matches formatted phone and DNI values through their digit fields', async () => {
		await GET(makeEvent('342 896'));

		expect(mocks.or).toHaveBeenCalledWith(
			expect.stringContaining('search_phone_digits.ilike.%342896%')
		);
		expect(mocks.or).toHaveBeenCalledWith(
			expect.stringContaining('search_dni_digits.ilike.%342896%')
		);
	});
});

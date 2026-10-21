import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOdontoContext: vi.fn(), from: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/business', () => ({ demoBusinessContext: vi.fn() }));
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getOdontoContext }));

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

const links = [{ professional_id: 'p1', professionals: { id: 'p1', name: 'Profesional Uno', specialty: null, is_active: true } }];
const appointment = { id: 'a1', starts_at: '2026-10-21T13:00:00.000Z', status: 'reserved' };
const failure = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };

const event = () =>
	({
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() },
		url: new URL('http://localhost/odonto/mis-turnos')
	}) as never;

// Each read of the page in order: the professional's links, today and the upcoming days.
const reads = (results: unknown[]) => {
	const queue = [...results];
	mocks.from.mockImplementation(() => query(queue.shift()));
};

describe('own appointments load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOdontoContext.mockResolvedValue({
			supabase: { from: mocks.from },
			business: { business: { id: 'business-1', timezone: 'America/Argentina/Buenos_Aires' }, role: 'professional' },
			userId: 'user-1'
		});
	});

	it('lists the professional appointments of today and the coming days', async () => {
		reads([{ data: links, error: null }, { data: [appointment], error: null }, { data: [appointment], error: null }]);
		const result = (await load(event())) as { todayAppointments: unknown[]; upcomingAppointments: unknown[] };
		expect([result.todayAppointments, result.upcomingAppointments]).toEqual([[appointment], [appointment]]);
	});

	it.each([
		['the professional links', [failure]],
		['today', [{ data: links, error: null }, failure, { data: [appointment], error: null }]],
		['the coming days', [{ data: links, error: null }, { data: [appointment], error: null }, failure]]
	])('fails explicitly instead of showing no appointments when %s cannot be read', async (_part, results) => {
		reads(results);
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOdontoContext: vi.fn(), from: vi.fn(), rpc: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/business', () => ({ demoBusinessContext: vi.fn() }));
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getOdontoContext }));

const { load } = await import('./+page.server');

const businessId = '00000000-0000-4000-8000-000000000001';
const timeZone = 'America/Argentina/Buenos_Aires';

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

// One week, from both sides: the appointments a reader would list and the counts the
// database would return. 01:30 UTC on Tuesday is still Monday in Buenos Aires.
const appointments = [
	{ id: 'a1', professional_id: 'p1', starts_at: '2026-10-26T12:00:00.000Z', status: 'reserved' },
	{ id: 'a2', professional_id: 'p1', starts_at: '2026-10-26T13:00:00.000Z', status: 'reserved' },
	{ id: 'a3', professional_id: 'p1', starts_at: '2026-10-26T14:00:00.000Z', status: 'confirmed' },
	{ id: 'a4', professional_id: 'p2', starts_at: '2026-10-27T01:30:00.000Z', status: 'cancelled' },
	{ id: 'a5', professional_id: 'p2', starts_at: '2026-10-28T12:00:00.000Z', status: 'reschedule_requested' }
];
const counts = [
	{ local_date: '2026-10-26', status: 'reserved', appointments: 2 },
	{ local_date: '2026-10-26', status: 'confirmed', appointments: 1 },
	{ local_date: '2026-10-26', status: 'cancelled', appointments: 1 },
	{ local_date: '2026-10-28', status: 'reschedule_requested', appointments: 1 }
];
const professionals = [{ id: 'p1', name: 'Profesional Uno', is_active: true }];

const event = (search = '?date=2026-10-28') =>
	({
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() },
		url: new URL(`http://localhost/odonto/agenda/semana${search}`)
	}) as never;

type Day = { date: string; total: number; stats: Array<{ status: string; count: number }> };
const count = (day: Day | undefined, status: string) => day?.stats.find((item) => item.status === status)?.count;

describe('weekly agenda load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOdontoContext.mockResolvedValue({
			supabase: { from: mocks.from, rpc: mocks.rpc },
			business: { business: { id: businessId, timezone: timeZone }, role: 'owner' },
			userId: 'user-1'
		});
	});

	it('counts each local day of the week by state', async () => {
		mocks.from.mockImplementation((table: string) =>
			query({ data: table === 'appointments' ? appointments : professionals, error: null }));
		mocks.rpc.mockReturnValue(query({ data: counts, error: null }));
		const result = (await load(event())) as { days: Day[]; professionals: unknown[] };
		const days = result.days;
		expect(days.map((day) => day.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
		expect([days[0].total, count(days[0], 'reserved'), count(days[0], 'confirmed'), count(days[0], 'cancelled')]).toEqual([4, 2, 1, 1]);
		expect([days[1].total, days[2].total, count(days[2], 'reschedule_requested')]).toEqual([0, 1, 1]);
		expect(result.professionals).toEqual(professionals);
		// Monday 00:00 to Sunday 23:59 in Buenos Aires (UTC-3), without a professional filter.
		expect(mocks.rpc).toHaveBeenCalledWith('agenda_week_counts', {
			p_business_id: businessId,
			p_from: '2026-10-26T03:00:00.000Z',
			p_to: '2026-11-02T02:59:00.000Z',
			p_time_zone: timeZone
		});
	});

	it('counts only the selected professional when the filter is set', async () => {
		const professionalId = '00000000-0000-4000-8000-000000000002';
		mocks.from.mockImplementation(() => query({ data: professionals, error: null }));
		mocks.rpc.mockReturnValue(query({ data: [], error: null }));
		await load(event(`?date=2026-10-28&professional_id=${professionalId}`));
		expect(mocks.rpc).toHaveBeenCalledWith('agenda_week_counts', expect.objectContaining({ p_professional_id: professionalId }));
	});

	it('fails explicitly instead of showing an empty week when the week cannot be read', async () => {
		const failure = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
		mocks.from.mockImplementation((table: string) => query(table === 'appointments' ? failure : { data: professionals, error: null }));
		mocks.rpc.mockReturnValue(query(failure));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
	});

	it('fails explicitly instead of hiding the professional filter when the team cannot be read', async () => {
		const failure = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
		mocks.from.mockImplementation((table: string) => query(table === 'appointments' ? { data: appointments, error: null } : failure));
		mocks.rpc.mockReturnValue(query({ data: counts, error: null }));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
	});

	describe('on Sunday 22:30 in Buenos Aires, already Monday in UTC', () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-11-02T01:30:00.000Z'));
			mocks.from.mockImplementation(() => query({ data: professionals, error: null }));
			mocks.rpc.mockReturnValue(query({ data: [], error: null }));
		});
		afterEach(() => vi.useRealTimers());

		it('takes the current week from the practice time zone, not from UTC', async () => {
			const result = (await load(event(''))) as { selectedDate: string; days: Day[] };
			expect([result.selectedDate, result.days[0].date, result.days[6].date]).toEqual(['2026-11-01', '2026-10-26', '2026-11-01']);
		});

		it('shows the current week instead of failing when the address carries an impossible date', async () => {
			for (const search of ['?date=hoy', '?date=2026-13-01', '?date=2026-02-31']) {
				const result = (await load(event(search))) as { selectedDate: string; days: Day[] };
				expect([search, result.selectedDate, result.days[0].date]).toEqual([search, '2026-11-01', '2026-10-26']);
			}
		});
	});

	it('refuses a malformed professional filter instead of reporting the week as unavailable', async () => {
		mocks.from.mockImplementation(() => query({ data: professionals, error: null }));
		mocks.rpc.mockReturnValue(query({ data: [], error: null }));
		await expect(load(event('?date=2026-10-28&professional_id=no-es-un-id'))).rejects.toMatchObject({ status: 400 });
		expect(mocks.rpc).not.toHaveBeenCalled();
	});
});

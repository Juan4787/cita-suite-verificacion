import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getOdontoContext: vi.fn(),
	from: vi.fn(),
	countTomorrowUncovered: vi.fn(),
	loadInternalAvailabilitySnapshot: vi.fn(),
	updateAppointmentStatus: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/business', () => ({ demoBusinessContext: vi.fn() }));
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getOdontoContext }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: vi.fn(async () => ({})) }));
vi.mock('$lib/server/scheduling/public/reminders', () => ({ countTomorrowUncovered: mocks.countTomorrowUncovered }));
vi.mock('$lib/server/integrations/public/google-calendar', () => ({ processAppointmentGoogleCalendarSync: vi.fn() }));
vi.mock('$lib/server/scheduling/public/appointments', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/scheduling/public/appointments')>()),
	updateAppointmentStatus: mocks.updateAppointmentStatus
}));
vi.mock('$lib/server/scheduling/public/availability-snapshot', () => ({
	defaultInternalAvailabilitySnapshotRange: () => ({ fromDate: '2026-10-21', toDate: '2026-11-04' }),
	loadInternalAvailabilitySnapshot: mocks.loadInternalAvailabilitySnapshot
}));

const { load, actions } = await import('./+page.server');

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

const professionalId = '00000000-0000-4000-8000-000000000002';
const appointment = { id: 'a1', patient_id: 'patient-1', service_id: 's1', professional_id: professionalId, starts_at: '2026-10-21T13:00:00.000Z', status: 'reserved' };
const snapshot = { professionals: [{ id: professionalId, name: 'Profesional Uno' }], services: [{ id: 's1', name: 'Consulta' }], assignments: [] };
const failure = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };

const event = (search = '?date=2026-10-21') =>
	({
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() },
		url: new URL(`http://localhost/odonto/agenda${search}`)
	}) as never;

describe('daily agenda load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOdontoContext.mockResolvedValue({
			supabase: { from: mocks.from },
			business: { business: { id: 'business-1', timezone: 'America/Argentina/Buenos_Aires' }, role: 'owner' },
			userId: 'user-1'
		});
		mocks.countTomorrowUncovered.mockResolvedValue(2);
		mocks.loadInternalAvailabilitySnapshot.mockResolvedValue(snapshot);
	});

	it('lists the day with its references and the reminders to send', async () => {
		mocks.from.mockReturnValue(query({ data: [appointment], error: null }));
		const result = (await load(event(`?date=2026-10-21&professional_id=${professionalId}`))) as {
			appointments: unknown[]; professionals: unknown[]; reminderCount: number | null;
		};
		expect([result.appointments, result.professionals, result.reminderCount]).toEqual([[appointment], snapshot.professionals, 2]);
	});

	it('fails explicitly instead of showing an empty day when the day cannot be read', async () => {
		mocks.from.mockReturnValue(query(failure));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
	});

	it('fails explicitly instead of asking to set up the practice when its references cannot be read', async () => {
		mocks.from.mockReturnValue(query({ data: [appointment], error: null }));
		mocks.loadInternalAvailabilitySnapshot.mockRejectedValue(new Error('availability window unavailable'));
		await expect(load(event(`?date=2026-10-21&professional_id=${professionalId}`))).rejects.toMatchObject({ status: 503 });
	});

	it('says the reminders could not be checked instead of hiding them', async () => {
		mocks.from.mockReturnValue(query({ data: [appointment], error: null }));
		mocks.countTomorrowUncovered.mockRejectedValue(new Error('reminders unavailable'));
		const result = (await load(event())) as { reminderCount: number | null };
		expect(result.reminderCount).toBeNull();
	});

	describe('on Sunday 22:30 in Buenos Aires, already Monday in UTC', () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-11-02T01:30:00.000Z'));
			mocks.from.mockReturnValue(query({ data: [], error: null }));
		});
		afterEach(() => vi.useRealTimers());

		it.each(['hoy', '2026-02-31', '2026-13-01'])(
			'shows the practice day instead of a date that does not exist (%s)',
			async (requested) => {
				const result = (await load(event(`?date=${requested}`))) as { date: string };
				expect(result.date).toBe('2026-11-01');
			}
		);

		it('returns to the practice day after a status change that carried no date', async () => {
			mocks.getOdontoContext.mockResolvedValue({
				supabase: { from: mocks.from },
				business: {
					business: { id: 'business-1', timezone: 'America/Argentina/Buenos_Aires' },
					role: 'owner',
					canOperate: true
				},
				userId: 'user-1'
			});
			const form = new FormData();
			form.set('appointment_id', 'a1');
			form.set('status', 'cancelled');
			await expect(
				actions.update_status({
					request: new Request('http://localhost/odonto/agenda?/update_status', { method: 'POST', body: form }),
					locals: { auth: { access_token: 'test-token' } },
					fetch: vi.fn(),
					cookies: { get: vi.fn() }
				} as never)
			).rejects.toMatchObject({ status: 303, location: '/odonto/agenda?date=2026-11-01' });
		});
	});
});

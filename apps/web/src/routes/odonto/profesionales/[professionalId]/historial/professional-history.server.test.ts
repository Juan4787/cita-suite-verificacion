import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOdontoContext: vi.fn(), from: vi.fn(), createSupabaseAdminClient: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getOdontoContext }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

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

const professional = { id: 'p1', name: 'Profesional Uno' };
const appointments = [{ id: 'a1', starts_at: '2026-10-20T13:00:00.000Z', status: 'confirmed', patient_id: 'patient-1' }];
const entries = [{ id: 'e1', created_at: '2026-10-20T14:00:00.000Z', patient_id: 'patient-1' }];
const failure = { data: null, count: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };

const tables = (overrides: Record<string, unknown> = {}) => {
	const results: Record<string, unknown> = {
		professionals: { data: professional, error: null },
		appointments: { data: appointments, count: 412, error: null },
		clinical_entries: { data: entries, count: 37, error: null },
		...overrides
	};
	mocks.from.mockImplementation((table: string) => query(results[table]));
	// The service role would return the same rows: the test checks which client reads them.
	mocks.createSupabaseAdminClient.mockResolvedValue({ from: mocks.from });
};

const event = () =>
	({
		params: { professionalId: 'p1' },
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() }
	}) as never;

type History = { appointments: unknown[]; appointmentsTotal: number; entriesTotal: number };

describe('professional history load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOdontoContext.mockResolvedValue({
			supabase: { from: mocks.from },
			business: { business: { id: 'business-1' }, role: 'owner', canManage: true },
			userId: 'user-1'
		});
	});

	it('reads the history with the user own rules, never with the service role', async () => {
		tables();
		await load(event());
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
		expect(mocks.from).toHaveBeenCalledWith('appointments');
	});

	it('tells the real totals when the list shows only the latest records', async () => {
		tables();
		const result = (await load(event())) as History;
		expect([result.appointments, result.appointmentsTotal, result.entriesTotal]).toEqual([appointments, 412, 37]);
	});

	// The page lists what must be resolved before removing the professional: a part of
	// it is not an answer, and the technical error stays in the logs.
	it.each(['professionals', 'appointments', 'clinical_entries'])('fails explicitly when %s cannot be read', async (table) => {
		tables({ [table]: failure });
		const failed = load(event());
		await expect(failed).rejects.toMatchObject({ status: 503 });
		await expect(failed).rejects.not.toMatchObject({ body: { message: expect.stringContaining('statement timeout') } });
	});
});

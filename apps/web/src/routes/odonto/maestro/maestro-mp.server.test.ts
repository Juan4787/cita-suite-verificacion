import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	getEmailFromAccessToken: vi.fn(),
	getUserIdFromAccessToken: vi.fn(),
	isMasterEmail: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	getEmailFromAccessToken: mocks.getEmailFromAccessToken,
	getUserIdFromAccessToken: mocks.getUserIdFromAccessToken,
	isMasterEmail: mocks.isMasterEmail
}));

const { actions } = await import('./+page.server');

const BUSINESS_ID = '44444444-4444-4444-8444-444444444444';

type QueuedResult = { data?: unknown; error?: { message: string } | null };

const createDbMock = (
	queues: Record<string, QueuedResult[]> = {},
	opts?: {
		authUsers?: Array<{ id: string; email: string }>;
		rpcResult?: QueuedResult;
	}
) => {
	const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
	const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
	const tableQueues: Record<string, QueuedResult[]> = {};
	for (const [table, queue] of Object.entries(queues)) tableQueues[table] = [...queue];
	const client = {
		from: vi.fn((table: string) => {
			const result = tableQueues[table]?.shift() ?? { data: null, error: null };
			const q: Record<string, unknown> = {};
			const chain =
				(method: string) =>
				(...args: unknown[]) => {
					calls.push({ table, method, args });
					return q;
				};
			for (const method of ['select', 'eq', 'in', 'order', 'limit', 'upsert', 'update', 'insert', 'delete']) {
				q[method] = vi.fn(chain(method));
			}
			q.maybeSingle = vi.fn(async () => result);
			q.single = vi.fn(async () => result);
			(q as { then?: unknown }).then = (
				resolve: (value: unknown) => unknown,
				reject: (reason: unknown) => unknown
			) => Promise.resolve(result).then(resolve, reject);
			return q;
		}),
		rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
			rpcCalls.push({ fn, args });
			return opts?.rpcResult ?? { data: [{ applied: true }], error: null };
		}),
		auth: {
			admin: {
				listUsers: vi.fn(async () => ({
					data: { users: opts?.authUsers ?? [] },
					error: null
				}))
			}
		}
	};
	return { client, calls, rpcCalls };
};

const createMpFetch = (routes: Array<[string, { status?: number; body?: unknown }]>) => {
	const requests: Array<{ url: string; method: string }> = [];
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		requests.push({ url, method: init?.method ?? 'GET' });
		const hit = routes.find(([fragment]) => url.includes(fragment));
		if (!hit) return new Response('{}', { status: 404 });
		return new Response(JSON.stringify(hit[1].body ?? {}), { status: hit[1].status ?? 200 });
	});
	return { fetchMock: fetchMock as unknown as typeof fetch, requests };
};

const makeEvent = (opts: { fetchMock: typeof fetch; formEntries?: Record<string, string> }) => ({
	locals: { auth: { access_token: 'token', refresh_token: 'r' } },
	fetch: opts.fetchMock,
	request: new Request('https://app.test/odonto/maestro', {
		method: 'POST',
		body: new URLSearchParams(opts.formEntries ?? {})
	})
});

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	envState.privateEnv.MP_ACCESS_TOKEN = 'token-de-prueba';
	mocks.getEmailFromAccessToken.mockReturnValue('master@mail.com');
	mocks.getUserIdFromAccessToken.mockReturnValue('master-user-id');
	mocks.isMasterEmail.mockImplementation((email?: string | null) => email === 'master@mail.com');
});

describe('action mp_cancel_subscription (maestro)', () => {
	it('cancela en MP una suscripción del consultorio y sincroniza el estado local', async () => {
		const admin = createDbMock({
			mp_subscriptions: [{ data: { preapproval_id: 'pre-9' }, error: null }, { error: null }]
		});
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock, requests } = createMpFetch([
			['/preapproval/pre-9', { status: 200, body: { id: 'pre-9', status: 'cancelled' } }]
		]);

		const result = (await actions.mp_cancel_subscription(
			makeEvent({
				fetchMock,
				formEntries: { business_id: BUSINESS_ID, preapproval_id: 'pre-9' }
			}) as never
		)) as { success?: boolean; message?: string };

		expect(result.success).toBe(true);
		expect(requests).toHaveLength(2);
		expect(requests[0].method).toBe('GET');
		expect(requests[0].url).toContain('/authorized_payments/search');
		expect(requests[1].method).toBe('PUT');
		expect(requests[1].url).toContain('/preapproval/pre-9');
		const update = admin.calls.find(
			(c) => c.table === 'mp_subscriptions' && c.method === 'update'
		);
		expect(update).toBeDefined();
		expect(update!.args[0]).toMatchObject({ status: 'cancelled' });
		// El aislamiento por consultorio se verifica con el filtro compuesto.
		expect(
			admin.calls.some(
				(c) => c.method === 'eq' && c.args[0] === 'business_id' && c.args[1] === BUSINESS_ID
			)
		).toBe(true);
	});

	it('no cancela suscripciones que no pertenecen al consultorio indicado', async () => {
		const admin = createDbMock({
			mp_subscriptions: [{ data: null, error: null }]
		});
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.mp_cancel_subscription(
			makeEvent({
				fetchMock,
				formEntries: { business_id: BUSINESS_ID, preapproval_id: 'pre-ajena' }
			}) as never
		)) as { status: number };

		expect(result.status).toBe(404);
		expect(requests).toHaveLength(0);
	});

	it('solo el maestro puede usar la action', async () => {
		mocks.isMasterEmail.mockReturnValue(false);
		const { fetchMock } = createMpFetch([]);

		await expect(
			actions.mp_cancel_subscription(
				makeEvent({
					fetchMock,
					formEntries: { business_id: BUSINESS_ID, preapproval_id: 'pre-9' }
				}) as never
			)
		).rejects.toMatchObject({ status: 303 });
	});
});

describe('action mp_reconcile_now (maestro)', () => {
	it('corre la conciliación real y devuelve el resumen', async () => {
		const admin = createDbMock({
			mp_subscriptions: [{ data: [], error: null }]
		});
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock } = createMpFetch([]);

		const result = (await actions.mp_reconcile_now(makeEvent({ fetchMock }) as never)) as {
			success?: boolean;
			message?: string;
		};

		expect(result.success).toBe(true);
		expect(result.message).toContain('0 suscripciones revisadas');
	});
});

describe('action create_business (maestro)', () => {
	it('crea owner ya registrado como membresía aceptada y activa', async () => {
		const ownerUserId = 'owner-user-id';
		const admin = createDbMock(
			{
				business_users: [{ data: [], error: null }],
				allowed_emails: [{ data: null, error: null }, { error: null }],
				businesses: [{ data: null, error: null }, { data: { id: BUSINESS_ID }, error: null }]
			},
			{ authUsers: [{ id: ownerUserId, email: 'cliente@example.com' }] }
		);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock } = createMpFetch([]);

		const result = (await actions.create_business(
			makeEvent({
				fetchMock,
				formEntries: {
					name: 'Consultorio Existente',
					owner_email: 'cliente@example.com',
					duration: 'month_1'
				}
			}) as never
		)) as { success?: boolean };

		expect(result.success).toBe(true);
		const membershipInsert = admin.calls.find(
			(c) => c.table === 'business_users' && c.method === 'insert'
		);
		expect(membershipInsert?.args[0]).toMatchObject({
			business_id: BUSINESS_ID,
			user_id: ownerUserId,
			role: 'owner',
			status: 'active',
			created_by: 'master-user-id',
			updated_by: 'master-user-id'
		});
		expect((membershipInsert?.args[0] as { accepted_at?: unknown })?.accepted_at).toEqual(expect.any(String));
	});

	it('crea consultorio manual con owner pendiente si el usuario Auth todavía no existe', async () => {
		const admin = createDbMock(
			{
				allowed_emails: [{ data: null, error: null }, { error: null }],
				businesses: [{ data: null, error: null }, { data: { id: BUSINESS_ID }, error: null }],
				business_user_invites: [{ data: [], error: null }, { error: null }]
			},
			{ authUsers: [] }
		);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock } = createMpFetch([]);

		const result = (await actions.create_business(
			makeEvent({
				fetchMock,
				formEntries: {
					name: 'Consultorio Nuevo',
					owner_email: 'cliente@example.com',
					duration: 'month_1',
					note: 'Alta guiada'
				}
			}) as never
		)) as { success?: boolean; message?: string };

		expect(result.success).toBe(true);
		expect(result.message).toContain('owner pendiente');
		expect(admin.client.auth.admin.listUsers).toHaveBeenCalled();
		const allowedInsert = admin.calls.find(
			(c) => c.table === 'allowed_emails' && c.method === 'insert'
		);
		expect(allowedInsert?.args[0]).toMatchObject({
			email: 'cliente@example.com',
			enabled: true,
			onboarding_mode: 'manual'
		});
		const inviteInsert = admin.calls.find(
			(c) => c.table === 'business_user_invites' && c.method === 'insert'
		);
		expect(inviteInsert?.args[0]).toMatchObject({
			business_id: BUSINESS_ID,
			email: 'cliente@example.com',
			role: 'owner',
			status: 'pending'
		});
		expect(admin.rpcCalls[0]).toMatchObject({
			fn: 'grant_business_access',
			args: {
				p_business_id: BUSINESS_ID,
				p_operation: 'grant_access',
				p_source: 'internal'
			}
		});
	});
});

describe('action adjust_business_access (maestro)', () => {
	it('envía exactamente 3600 segundos y confirma 1 hora sin redondearla a un día', async () => {
		const admin = createDbMock({
			business_users: [{ data: [], error: null }]
		});
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock } = createMpFetch([]);

		const result = (await actions.adjust_business_access(
			makeEvent({
				fetchMock,
				formEntries: {
					business_id: BUSINESS_ID,
					operation: 'extend_access',
					duration: 'hour_1',
					idempotency_key: 'grant-one-hour'
				}
			}) as never
		)) as { success?: boolean; message?: string };

		expect(result).toEqual({ success: true, message: 'Listo: se sumó 1 hora de acceso.' });
		expect(admin.rpcCalls).toContainEqual({
			fn: 'grant_business_access',
			args: expect.objectContaining({
				p_business_id: BUSINESS_ID,
				p_operation: 'extend_access',
				p_duration_seconds: 3600,
				p_duration_unit: 'hour',
				p_is_permanent: false
			})
		});
	});
});

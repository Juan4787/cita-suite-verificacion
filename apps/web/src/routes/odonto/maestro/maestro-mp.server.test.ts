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
vi.mock('$lib/server/platform/supabase', () => ({
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
			for (const method of ['select', 'eq', 'in', 'order', 'limit', 'upsert', 'update', 'insert', 'delete', 'retry']) {
				q[method] = vi.fn(chain(method));
			}
			// Like the SDK, the single-row builders can be awaited or configured further.
			q.maybeSingle = vi.fn(() => q);
			q.single = vi.fn(() => q);
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
	// The identity Auth verified in hooks, which the panel trusts.
	locals: { auth: { access_token: 'token', refresh_token: 'r' }, verifiedUser: { id: 'master-user-id', email: 'master@mail.com' } },
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
	const createForm = (overrides: Record<string, string> = {}) => ({
		name: 'Consultorio Nuevo',
		owner_email: ' Cliente@Example.com ',
		duration: 'month_1',
		...overrides
	});
	const writes = (calls: Array<{ method: string }>) =>
		calls.filter((call) => ['insert', 'update', 'upsert', 'delete'].includes(call.method));

	it('crea consultorio, owner y acceso inicial en una sola transacción de la base', async () => {
		const admin = createDbMock(
			{},
			{ rpcResult: { data: [{ business_id: BUSINESS_ID, owner_linked: true }], error: null } }
		);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock } = createMpFetch([]);

		const result = (await actions.create_business(
			makeEvent({ fetchMock, formEntries: createForm({ note: 'Alta guiada' }) }) as never
		)) as { success?: boolean; message?: string };

		expect(result).toEqual({
			success: true,
			message: 'Consultorio creado y owner vinculado. Acceso inicial: 1 mes.'
		});
		expect(admin.rpcCalls).toEqual([
			{
				fn: 'create_business_with_owner',
				args: {
					p_name: 'Consultorio Nuevo',
					p_slug_base: 'consultorio-nuevo',
					p_owner_email: 'cliente@example.com',
					p_duration_seconds: 30 * 24 * 60 * 60,
					p_duration_unit: 'month',
					p_is_permanent: false,
					p_note: 'Alta guiada',
					p_access_note: 'Alta guiada',
					p_admin_id: 'master-user-id',
					p_admin_email: 'master@mail.com',
					p_idempotency_key: expect.any(String)
				}
			}
		]);
		// Nothing is written outside that transaction, and Auth is not scanned for the owner.
		expect(writes(admin.calls)).toEqual([]);
		expect(admin.client.auth.admin.listUsers).not.toHaveBeenCalled();
	});

	it('informa el owner pendiente cuando todavía no tiene cuenta, con el acceso permanente', async () => {
		const admin = createDbMock(
			{},
			{ rpcResult: { data: [{ business_id: BUSINESS_ID, owner_linked: false }], error: null } }
		);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock } = createMpFetch([]);

		const result = (await actions.create_business(
			makeEvent({ fetchMock, formEntries: createForm({ duration: 'permanent' }) }) as never
		)) as { success?: boolean; message?: string };

		expect(result).toEqual({
			success: true,
			message:
				'Consultorio creado con owner pendiente. Acceso inicial: permanente. Cuando el owner ingrese, se vinculará automáticamente.'
		});
		expect(admin.rpcCalls[0]?.args).toMatchObject({
			p_duration_seconds: null,
			p_duration_unit: 'permanent',
			p_is_permanent: true,
			p_note: null,
			p_access_note: 'Consultorio creado con acceso inicial: permanente.'
		});
	});

	it('rechaza un email de otro consultorio sin escrituras sueltas', async () => {
		const admin = createDbMock(
			{},
			{ rpcResult: { data: null, error: { message: 'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS' } } }
		);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock } = createMpFetch([]);

		const result = (await actions.create_business(makeEvent({ fetchMock, formEntries: createForm() }) as never)) as {
			status: number;
			data: { message: string };
		};

		expect(result.status).toBe(409);
		expect(result.data.message).toBe('Ese email ya pertenece a otro consultorio.');
		expect(writes(admin.calls)).toEqual([]);
	});

	it('no informa éxito ni un fallo seguro si la transacción falla o su respuesta no identifica el consultorio', async () => {
		for (const rpcResult of [
			{ data: null, error: { message: 'connection reset' } },
			{ data: [], error: null },
			{ data: [{ business_id: 'no-es-un-id', owner_linked: true }], error: null },
			{ data: [{ business_id: BUSINESS_ID }], error: null }
		]) {
			const admin = createDbMock({}, { rpcResult });
			mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
			const { fetchMock } = createMpFetch([]);

			const result = (await actions.create_business(
				makeEvent({ fetchMock, formEntries: createForm() }) as never
			)) as { status: number; data: { message: string } };

			expect(result.status).toBe(503);
			expect(result.data.message).toBe(
				'No pudimos confirmar el alta del consultorio. Revisá la lista de consultorios antes de volver a intentarlo.'
			);
			expect(writes(admin.calls)).toEqual([]);
		}
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

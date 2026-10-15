import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn(),
	createSupabaseAdminClient: vi.fn(),
	resolveActiveBusiness: vi.fn(),
	demoBusinessContext: vi.fn(() => ({}))
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock('$lib/server/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness,
	demoBusinessContext: mocks.demoBusinessContext
}));
vi.mock('$lib/server/messaging', () => ({
	getExternalCallbackSiteUrl: () => 'https://app.test'
}));

const { load, actions } = await import('./+page.server');

const BUSINESS_ID = '33333333-3333-4333-8333-333333333333';
const PAGE_URL = 'https://app.test/odonto/configuracion/suscripcion';

const ownerContext = (
	overrides?: Partial<{
		isPermanent: boolean;
		role: string;
		commercialStatus: string;
		commercialAccessEnabled: boolean;
		archivedAt: string | null;
	}>
) => ({
	business: { id: BUSINESS_ID, name: 'Consultorio Test', email: 'negocio@mail.com' },
	role: overrides?.role ?? 'owner',
	canManage: true,
	canOperate: true,
	access: {
		isPermanent: overrides?.isPermanent ?? false,
		commercialStatus: overrides?.commercialStatus ?? 'active',
		commercialAccessEnabled: overrides?.commercialAccessEnabled ?? true,
		archivedAt: overrides?.archivedAt ?? null
	}
});

const assistedContext = () => ({
	...ownerContext({ role: 'admin' }),
	assistance: {
		grantId: 'assist-1',
		requestedByUserId: 'owner-1',
		supportUserId: 'master-1',
		startsAt: '2026-07-08T20:45:00.000Z',
		expiresAt: '2026-07-08T21:45:00.000Z'
	}
});

type QueuedResult = { data?: unknown; error?: { message: string } | null };

// Builder encadenable: cualquier cadena select/eq/order/limit/upsert/update se
// puede await-ear y resuelve el resultado encolado para esa tabla.
const createDbMock = (
	queues: Record<string, QueuedResult[]> = {},
	opts?: {
		rpcResult?: { data?: unknown; error?: { message: string } | null };
		rateLimitResult?: { data?: unknown; error?: { message: string } | null };
	}
) => {
	const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
	const tableQueues: Record<string, QueuedResult[]> = {};
	for (const [table, queue] of Object.entries(queues)) tableQueues[table] = [...queue];
	const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
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
			for (const method of ['select', 'eq', 'in', 'order', 'limit', 'upsert', 'update', 'insert']) {
				q[method] = vi.fn(chain(method));
			}
			q.maybeSingle = vi.fn(async () => result);
			(q as { then?: unknown }).then = (
				resolve: (value: unknown) => unknown,
				reject: (reason: unknown) => unknown
			) => Promise.resolve(result).then(resolve, reject);
			return q;
		}),
			rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
				rpcCalls.push({ fn, args });
				if (fn === 'consume_server_rate_limits') {
					return (
						opts?.rateLimitResult ?? {
							data: [{ allowed: true, used: 1, retry_after_seconds: 0 }],
							error: null
						}
					);
			}
			return (
				opts?.rpcResult ?? {
					data: [{ applied: true, grant_id: 'grant-1', status_after: 'active' }],
					error: null
				}
			);
		}),
		auth: {
			getUser: vi.fn(async () => ({ data: { user: { email: 'duena@mail.com' } }, error: null }))
		}
	};
	return { client, calls, rpcCalls };
};

type FetchCall = { url: string; method: string; body: Record<string, unknown> | null };

const createMpFetch = (
	routes: Array<[
		string,
		{ status?: number; body?: unknown; method?: 'GET' | 'POST' | 'PUT' }
	]>
) => {
	const requests: FetchCall[] = [];
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		let parsedBody: Record<string, unknown> | null = null;
		if (init?.body && typeof init.body === 'string') {
			try {
				parsedBody = JSON.parse(init.body) as Record<string, unknown>;
			} catch {
				parsedBody = null;
			}
		}
		const method = init?.method ?? 'GET';
		requests.push({ url, method, body: parsedBody });
		const hit = routes.find(
			([fragment, response]) => url.includes(fragment) && (!response.method || response.method === method)
		);
		if (!hit) return new Response('{}', { status: 404 });
		return new Response(JSON.stringify(hit[1].body ?? {}), { status: hit[1].status ?? 200 });
	});
	return { fetchMock: fetchMock as unknown as typeof fetch, requests };
};

const makeEvent = (opts: {
	fetchMock: typeof fetch;
	url?: string;
	formEntries?: Record<string, string>;
}) => ({
	locals: { auth: { access_token: 'token', refresh_token: 'r' } },
	fetch: opts.fetchMock,
	cookies: {},
	url: new URL(opts.url ?? PAGE_URL),
	request: new Request(PAGE_URL, {
		method: 'POST',
		body: new URLSearchParams(opts.formEntries ?? {})
	})
});

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	envState.privateEnv.MP_ACCESS_TOKEN = 'token-de-prueba';
	envState.privateEnv.MP_WEBHOOK_SECRET = 'secreto';
	envState.privateEnv.MP_ENVIRONMENT = 'test';
});

describe('action subscribe', () => {
	it('crea el preapproval con el contrato acordado y redirige a init_point', async () => {
		const server = createDbMock();
		// 1) chequeo de suscripción existente (vacío) 2) upsert del mapeo
		const admin = createDbMock({
			mp_subscriptions: [{ data: [], error: null }, { error: null }]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([
			[
				'/preapproval',
				{
					status: 201,
					body: { id: 'pre-9', status: 'pending', init_point: 'https://mp.test/init/pre-9' }
				}
			]
		]);

		await expect(
			actions.subscribe(makeEvent({ fetchMock }) as never)
		).rejects.toMatchObject({ status: 303, location: 'https://mp.test/init/pre-9' });

		expect(requests).toHaveLength(1);
		expect(requests[0].method).toBe('POST');
		const body = requests[0].body!;
		expect(body).toMatchObject({
			reason: 'Cita Suite — Suscripción mensual',
			external_reference: BUSINESS_ID,
			payer_email: 'duena@mail.com',
			back_url: 'https://app.test/odonto/pago/procesando?mp=retorno',
			status: 'pending',
			auto_recurring: {
				frequency: 1,
				frequency_type: 'months',
				transaction_amount: 50000,
				currency_id: 'ARS'
			}
		});
		// Decisiones de producto: sin exclusiones de medios de pago y sin trial.
		expect(body).not.toHaveProperty('excluded_payment_methods');
		expect(body).not.toHaveProperty('excluded_payment_types');
		expect(body.auto_recurring).not.toHaveProperty('free_trial');

		const upsert = admin.calls.find((c) => c.table === 'mp_subscriptions' && c.method === 'upsert');
		expect(upsert).toBeDefined();
		expect(upsert!.args[0]).toMatchObject({
			business_id: BUSINESS_ID,
			preapproval_id: 'pre-9',
			status: 'pending',
			transaction_amount: 50000
		});
	});

	it('no crea ningún cobro si falta el cliente administrativo', async () => {
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockRejectedValueOnce(new Error('service role ausente'));
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([]);
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
			data: { message?: string };
		};

		expect(result).toMatchObject({
			status: 503,
			data: {
				message:
					'No pudimos preparar el ingreso a Mercado Pago. No se generó ningún cobro. Probá de nuevo en unos minutos; si continúa, contactá a soporte.'
			}
		});
		expect(requests).toHaveLength(0);
		expect(log).toHaveBeenCalledOnce();
		log.mockRestore();
	});

	it('mantiene el error dentro del formulario si no puede cargar el contexto', async () => {
		mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error('Supabase no disponible'));
		const { fetchMock, requests } = createMpFetch([]);
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
			data: { message?: string };
		};

		expect(result.status).toBe(503);
		expect(result.data.message).toContain('No se generó ningún cobro');
		expect(requests).toHaveLength(0);
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
		log.mockRestore();
	});

	it('no continúa si la sesión no tiene un consultorio activo', async () => {
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.resolveActiveBusiness.mockResolvedValue(null);
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
			data: { message?: string };
		};

		expect(result.status).toBe(503);
		expect(result.data.message).toContain('No se generó ningún cobro');
		expect(requests).toHaveLength(0);
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
	});

	it('no abre Mercado Pago si el control de suscripción no se puede comprobar', async () => {
		const server = createDbMock();
		const admin = createDbMock(
			{ mp_subscriptions: [{ data: [], error: null }] },
			{ rateLimitResult: { data: null, error: { message: 'RPC no disponible' } } }
		);
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([]);
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
			data: { message?: string };
		};

		expect(result.status).toBe(503);
		expect(result.data.message).toContain('No se generó ningún cobro');
		expect(requests).toHaveLength(0);
		expect(log).toHaveBeenCalledWith(
			'Error validando rate limit de suscripción MP',
			expect.any(Error)
		);
		log.mockRestore();
	});

	it('informa un límite real y tampoco genera un cobro', async () => {
		const server = createDbMock();
		const admin = createDbMock(
			{ mp_subscriptions: [{ data: [], error: null }] },
			{
				rateLimitResult: {
					data: [{ allowed: false, used: 1, retry_after_seconds: 60 }],
					error: null
				}
			}
		);
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
			data: { message?: string };
		};

		expect(result.status).toBe(429);
		expect(result.data.message).toContain('No se generó ningún cobro');
		expect(requests).toHaveLength(0);
	});

	it('reutiliza el preapproval pendiente en vez de crear otra suscripción', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			mp_subscriptions: [
				{
					data: [
						{
							preapproval_id: 'pre-pending',
							status: 'pending',
							created_at: new Date().toISOString()
						}
					],
					error: null
				},
				{ error: null }
			],
			businesses: [{ data: { id: BUSINESS_ID }, error: null }]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([
			[
				'/preapproval/pre-pending',
				{
					body: {
						id: 'pre-pending',
						status: 'pending',
						external_reference: BUSINESS_ID,
						init_point: 'https://mp.test/init/pre-pending',
						payer_email: 'duena@mail.com',
						auto_recurring: { transaction_amount: 50000, currency_id: 'ARS' }
					}
				}
			]
		]);

		await expect(actions.subscribe(makeEvent({ fetchMock }) as never)).rejects.toMatchObject({
			status: 303,
			location: 'https://mp.test/init/pre-pending'
		});
		expect(requests).toHaveLength(1);
		expect(requests[0].method).toBe('GET');
		expect(
			admin.calls.filter((call) => call.table === 'mp_subscriptions' && call.method === 'upsert')
		).toHaveLength(1);
	});

	it('cancela todos los pendings duplicados, aunque sean recientes, antes de crear uno nuevo', async () => {
		const server = createDbMock();
		const existing = [
			{ preapproval_id: 'pre-a', status: 'pending', created_at: new Date().toISOString() },
			{ preapproval_id: 'pre-b', status: 'pending', created_at: new Date().toISOString() }
		];
		const admin = createDbMock({
			mp_subscriptions: [
				{ data: existing, error: null },
				{ error: null },
				{ error: null },
				{ error: null },
				{ error: null },
				{ error: null }
			],
			businesses: [
				{ data: { id: BUSINESS_ID }, error: null },
				{ data: { id: BUSINESS_ID }, error: null },
				{ data: { id: BUSINESS_ID }, error: null },
				{ data: { id: BUSINESS_ID }, error: null }
			]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const pending = (id: string) => ({
			id,
			status: 'pending',
			external_reference: BUSINESS_ID,
			init_point: `https://mp.test/init/${id}`,
			payer_email: 'duena@mail.com',
			auto_recurring: { transaction_amount: 50000, currency_id: 'ARS' }
		});
		const { fetchMock, requests } = createMpFetch([
			['/preapproval/pre-a', { method: 'GET', body: pending('pre-a') }],
			['/preapproval/pre-b', { method: 'GET', body: pending('pre-b') }],
			['/preapproval/pre-a', { method: 'PUT', body: { ...pending('pre-a'), status: 'cancelled' } }],
			['/preapproval/pre-b', { method: 'PUT', body: { ...pending('pre-b'), status: 'cancelled' } }],
			[
				'/preapproval',
				{
					method: 'POST',
					status: 201,
					body: { id: 'pre-new', status: 'pending', init_point: 'https://mp.test/init/pre-new' }
				}
			]
		]);

		await expect(actions.subscribe(makeEvent({ fetchMock }) as never)).rejects.toMatchObject({
			status: 303,
			location: 'https://mp.test/init/pre-new'
		});
		expect(requests.map((request) => request.method).sort()).toEqual([
			'GET',
			'GET',
			'POST',
			'PUT',
			'PUT'
		]);
		const methods = requests.map((request) => request.method);
		expect(methods.indexOf('POST')).toBeGreaterThan(methods.lastIndexOf('PUT'));
		expect(admin.calls.some((call) => call.table === 'mp_subscriptions' && call.method === 'limit')).toBe(false);
	});

	it('si un pending ya fue autorizado, cancela los otros links antes de bloquear el alta', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			mp_subscriptions: [
				{
					data: [
						{ preapproval_id: 'pre-active', status: 'pending', created_at: new Date().toISOString() },
						{ preapproval_id: 'pre-extra', status: 'pending', created_at: new Date().toISOString() }
					],
					error: null
				},
				{ error: null },
				{ error: null },
				{ error: null }
			],
			businesses: [
				{ data: { id: BUSINESS_ID }, error: null },
				{ data: { id: BUSINESS_ID }, error: null },
				{ data: { id: BUSINESS_ID }, error: null }
			]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const base = (id: string, status: string) => ({
			id,
			status,
			external_reference: BUSINESS_ID,
			init_point: `https://mp.test/init/${id}`,
			payer_email: 'duena@mail.com',
			auto_recurring: { transaction_amount: 50000, currency_id: 'ARS' }
		});
		const { fetchMock, requests } = createMpFetch([
			['/preapproval/pre-active', { method: 'GET', body: base('pre-active', 'authorized') }],
			['/preapproval/pre-extra', { method: 'GET', body: base('pre-extra', 'pending') }],
			['/preapproval/pre-extra', { method: 'PUT', body: base('pre-extra', 'cancelled') }]
		]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
			data: { message?: string };
		};
		expect(result.status).toBe(400);
		expect(result.data.message).toContain('ya está activa o pausada');
		expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(1);
		expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
	});

	it('si ya hay una fila autorizada localmente, también cancela cualquier pending coexistente', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			mp_subscriptions: [
				{
					data: [
						{ preapproval_id: 'pre-active', status: 'authorized', created_at: new Date().toISOString() },
						{ preapproval_id: 'pre-extra', status: 'pending', created_at: new Date().toISOString() }
					],
					error: null
				},
				{ error: null },
				{ error: null }
			],
			businesses: [
				{ data: { id: BUSINESS_ID }, error: null },
				{ data: { id: BUSINESS_ID }, error: null }
			]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const pending = {
			id: 'pre-extra',
			status: 'pending',
			external_reference: BUSINESS_ID,
			init_point: 'https://mp.test/init/pre-extra',
			payer_email: 'duena@mail.com',
			auto_recurring: { transaction_amount: 50000, currency_id: 'ARS' }
		};
		const { fetchMock, requests } = createMpFetch([
			['/preapproval/pre-extra', { method: 'GET', body: pending }],
			[
				'/preapproval/pre-extra',
				{ method: 'PUT', body: { ...pending, status: 'cancelled' } }
			]
		]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
			data: { message?: string };
		};
		expect(result.status).toBe(400);
		expect(result.data.message).toContain('ya está activa o pausada');
		expect(requests.map((request) => request.method)).toEqual(['GET', 'PUT']);
		expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
	});

	it('usa MP_SUBSCRIPTION_AMOUNT_ARS cuando está configurado', async () => {
		envState.privateEnv.MP_SUBSCRIPTION_AMOUNT_ARS = '65000';
		const server = createDbMock();
		const admin = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([
			['/preapproval', { status: 201, body: { id: 'p', status: 'pending', init_point: 'https://mp.test/i' } }]
		]);

		await expect(actions.subscribe(makeEvent({ fetchMock }) as never)).rejects.toMatchObject({
			status: 303
		});
		expect(
			(requests[0].body!.auto_recurring as Record<string, unknown>).transaction_amount
		).toBe(65000);
	});

	it('devuelve 502 cuando Mercado Pago rechaza la solicitud', async () => {
		const server = createDbMock();
		const admin = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock } = createMpFetch([
			['/preapproval', { status: 400, body: { message: 'invalid payer_email' } }]
		]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
		};
		expect(result.status).toBe(502);
	});

	it('devuelve error operativo claro y no llama a MP si falta MP_ACCESS_TOKEN', async () => {
		delete envState.privateEnv.MP_ACCESS_TOKEN;
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
			data: { message?: string };
		};

		expect(result.status).toBe(503);
		expect(result.data.message).toContain('No se generó ningún cobro');
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
		expect(requests).toHaveLength(0);
	});

	it('bloquea una segunda suscripción cuando ya hay una activa o pausada (anti doble débito)', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			mp_subscriptions: [
				{ data: [{ preapproval_id: 'pre-a', status: 'authorized' }], error: null }
			]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
		};

		expect(result.status).toBe(400);
		// Nunca se llegó a crear un preapproval en MP.
		expect(requests).toHaveLength(0);
	});

	it('aplica rate limit antes de crear una suscripción en Mercado Pago', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			mp_subscriptions: [{ data: [], error: null }]
		});
		admin.client.rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
			admin.rpcCalls.push({ fn, args });
			if (fn === 'consume_server_rate_limits') {
				return { data: [{ allowed: false, used: 3, retry_after_seconds: 600 }], error: null };
			}
			return { data: [{ applied: true, grant_id: 'grant-1', status_after: 'active' }], error: null };
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
			data: { message?: string };
		};

		expect(result.status).toBe(429);
		expect(result.data.message).toContain('Hicimos varios intentos de activar la suscripción');
		expect(result.data.message).toContain('No se generó ningún cobro');
		expect(requests).toHaveLength(0);
		expect(admin.rpcCalls.find((call) => call.fn === 'consume_server_rate_limits')?.args).toMatchObject({
			p_action: 'mp_subscription_create_by_business'
		});
	});

	it('rechaza la suscripción para cuentas permanentes', async () => {
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext({ isPermanent: true }));
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
		};
		expect(result.status).toBe(400);
		expect(requests).toHaveLength(0);
	});

	it('rechaza la suscripción si el acceso fue suspendido manualmente', async () => {
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.resolveActiveBusiness.mockResolvedValue(
			ownerContext({ commercialAccessEnabled: false })
		);
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
		};
		expect(result.status).toBe(409);
		expect(requests).toHaveLength(0);
	});

	it('permite activar cuando el estado archived es solo vencimiento total', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			mp_subscriptions: [{ data: [], error: null }, { error: null }]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(
			ownerContext({ commercialStatus: 'archived', commercialAccessEnabled: true, archivedAt: null })
		);
		const { fetchMock, requests } = createMpFetch([
			[
				'/preapproval',
				{
					status: 201,
					body: { id: 'pre-vencida', status: 'pending', init_point: 'https://mp.test/init' }
				}
			]
		]);

		await expect(actions.subscribe(makeEvent({ fetchMock }) as never)).rejects.toMatchObject({
			status: 303,
			location: 'https://mp.test/init'
		});
		expect(requests).toHaveLength(1);
	});

	it('rechaza activar una cuenta archivada administrativamente', async () => {
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.resolveActiveBusiness.mockResolvedValue(
			ownerContext({
				commercialStatus: 'archived',
				commercialAccessEnabled: true,
				archivedAt: '2026-07-01T10:00:00.000Z'
			})
		);
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
		};
		expect(result.status).toBe(409);
		expect(requests).toHaveLength(0);
	});

	it('rechaza roles sin permiso', async () => {
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext({ role: 'reception' }));
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
		};
		expect(result.status).toBe(403);
		expect(requests).toHaveLength(0);
	});

	it('rechaza crear pagos desde una sesión de ayuda', async () => {
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.resolveActiveBusiness.mockResolvedValue(assistedContext());
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as {
			status: number;
		};
		expect(result.status).toBe(403);
		expect(requests).toHaveLength(0);
	});
});

describe('action cancel', () => {
	it('cancela en MP y sincroniza el estado local cuando la suscripción es del negocio', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			mp_subscriptions: [{ data: { preapproval_id: 'pre-9' }, error: null }, { error: null }]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([
			// Barrido de cobros finales antes de cancelar (sin cobros pendientes).
			['/authorized_payments/search', { status: 200, body: { results: [] } }],
			['/preapproval/pre-9', { status: 200, body: { id: 'pre-9', status: 'cancelled' } }]
		]);

		const result = (await actions.cancel(
			makeEvent({ fetchMock, formEntries: { preapproval_id: 'pre-9' } }) as never
		)) as { success?: boolean };

		expect(result.success).toBe(true);
		// Barrido (GET search) + cancelación (PUT).
		const put = requests.find((r) => r.method === 'PUT');
		expect(put).toBeDefined();
		expect(put!.url).toContain('/preapproval/pre-9');
		expect(put!.body).toEqual({ status: 'cancelled' });
		const update = admin.calls.find(
			(c) => c.table === 'mp_subscriptions' && c.method === 'update'
		);
		expect(update).toBeDefined();
		expect(update!.args[0]).toMatchObject({ status: 'cancelled' });
	});

	it('rechaza cancelar pagos desde una sesión de ayuda', async () => {
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.resolveActiveBusiness.mockResolvedValue(assistedContext());
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.cancel(
			makeEvent({ fetchMock, formEntries: { preapproval_id: 'pre-9' } }) as never
		)) as { status: number };

		expect(result.status).toBe(403);
		expect(requests).toHaveLength(0);
	});

	it('acredita el cobro final pendiente antes de cancelar (no pierde el último mes)', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			mp_subscriptions: [{ data: { preapproval_id: 'pre-9' }, error: null }, { error: null }],
			businesses: [{ data: { id: BUSINESS_ID }, error: null }],
			business_subscriptions: [{ data: { is_permanent: false }, error: null }]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock } = createMpFetch([
			[
				'/authorized_payments/search',
				{
					status: 200,
					body: {
						results: [{ id: 5, transaction_amount: 50000, payment: { id: 808, status: 'approved' } }]
					}
				}
			],
			['/preapproval/pre-9', { status: 200, body: { id: 'pre-9', status: 'cancelled' } }]
		]);

		const result = (await actions.cancel(
			makeEvent({ fetchMock, formEntries: { preapproval_id: 'pre-9' } }) as never
		)) as { success?: boolean };

		expect(result.success).toBe(true);
		// El cobro aprobado que el webhook no registró se acredita antes de que
		// la fila salga del filtro de conciliación.
		const credit = admin.rpcCalls.find(
			(c) => c.args.p_idempotency_key === 'mp:payment:808'
		);
		expect(credit).toBeDefined();
		expect(credit!.args.p_operation).toBe('payment_registered');
	});

	it('no cancela preapprovals que no pertenecen al negocio activo', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			mp_subscriptions: [{ data: null, error: null }]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.cancel(
			makeEvent({ fetchMock, formEntries: { preapproval_id: 'pre-ajena' } }) as never
		)) as { status: number };

		expect(result.status).toBe(404);
		expect(requests).toHaveLength(0);
		// El control de seguridad real es el filtro por negocio en la query de
		// pertenencia: si alguien lo saca, este assert lo delata.
		expect(
			admin.calls.some(
				(c) =>
					c.table === 'mp_subscriptions' &&
					c.method === 'eq' &&
					c.args[0] === 'business_id' &&
					c.args[1] === BUSINESS_ID
			)
		).toBe(true);
	});
});

describe('load', () => {
	it('con ?mp=retorno confirma contra MP y acredita el primer cobro idempotentemente', async () => {
		const server = createDbMock({ access_grants: [{ data: [], error: null }] });
		const admin = createDbMock({
			mp_subscriptions: [
				// 1) filas para la confirmación activa
				{ data: [{ preapproval_id: 'pre-9', status: 'pending' }], error: null },
				// 2) upsert de sincronización
				{ error: null },
				// 3) chequeo anti-doble-débito tras sincronizar authorized (una sola)
				{ data: [{ preapproval_id: 'pre-9' }], error: null },
				// 4) lectura final para la vista
				{
					data: [
						{
							preapproval_id: 'pre-9',
							status: 'authorized',
							payer_email: 'duena@mail.com',
							transaction_amount: 50000,
							next_charge_at: '2026-08-05T12:00:00.000Z',
							updated_at: '2026-07-05T12:00:00.000Z'
						}
					],
					error: null
				}
			],
			// El negocio se verifica dos veces: al sincronizar el preapproval y en
			// el pre-check de la acreditación.
			businesses: [
				{ data: { id: BUSINESS_ID }, error: null },
				{ data: { id: BUSINESS_ID }, error: null }
			],
			business_subscriptions: [{ data: { is_permanent: false }, error: null }]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock } = createMpFetch([
			[
				'/preapproval/pre-9',
				{
					body: {
						id: 'pre-9',
						status: 'authorized',
						external_reference: BUSINESS_ID,
						payer_email: 'duena@mail.com',
						auto_recurring: { transaction_amount: 50000, currency_id: 'ARS' }
					}
				}
			],
			[
				'/authorized_payments/search',
				{
					body: {
						results: [
							{ id: 900, transaction_amount: 50000, payment: { id: 777, status: 'approved' } }
						]
					}
				}
			]
		]);

		const data = (await load(
			makeEvent({ fetchMock, url: `${PAGE_URL}?mp=retorno` }) as never
		)) as {
			mpReturn: { subscriptionStatus: string | null; creditedNow: boolean; accessBlocked: boolean };
			mpSubscription: { status: string } | null;
		};

		expect(admin.rpcCalls).toHaveLength(1);
		expect(admin.rpcCalls[0].args).toMatchObject({
			p_operation: 'payment_registered',
			p_idempotency_key: 'mp:payment:777',
			p_admin_id: null
		});
		expect(data.mpReturn).toEqual({
			subscriptionStatus: 'authorized',
			creditedNow: true,
			accessBlocked: false
		});
		expect(data.mpSubscription?.status).toBe('authorized');
		// Tras acreditar se refresca el contexto para mostrar el acceso al día.
		expect(mocks.resolveActiveBusiness).toHaveBeenCalledTimes(2);
	});

	it('con ?mp=retorno refresca el contexto aunque el webhook haya acreditado primero (duplicado)', async () => {
		const server = createDbMock({ access_grants: [{ data: [], error: null }] });
		const admin = createDbMock(
			{
				mp_subscriptions: [
					{ data: [{ preapproval_id: 'pre-9', status: 'authorized' }], error: null },
					{ error: null },
					{ data: [], error: null }
				],
				businesses: [
					{ data: { id: BUSINESS_ID }, error: null },
					{ data: { id: BUSINESS_ID }, error: null }
				],
				business_subscriptions: [{ data: { is_permanent: false }, error: null }]
			},
			// El webhook ya acreditó este pago: la RPC devuelve applied=false.
			{ rpcResult: { data: [{ applied: false, grant_id: 'grant-w', status_after: 'active' }], error: null } }
		);
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock } = createMpFetch([
			[
				'/preapproval/pre-9',
				{
					body: { id: 'pre-9', status: 'authorized', external_reference: BUSINESS_ID }
				}
			],
			[
				'/authorized_payments/search',
				{
					body: {
						results: [
							{ id: 900, transaction_amount: 50000, payment: { id: 777, status: 'approved' } }
						]
					}
				}
			]
		]);

		const data = (await load(
			makeEvent({ fetchMock, url: `${PAGE_URL}?mp=retorno` }) as never
		)) as {
			mpReturn: { creditedNow: boolean; subscriptionStatus: string | null };
		};

		expect(data.mpReturn.creditedNow).toBe(false);
		expect(data.mpReturn.subscriptionStatus).toBe('authorized');
		// Aun sin acreditar acá, el contexto se refresca para mostrar el acceso
		// que el webhook ya activó.
		expect(mocks.resolveActiveBusiness).toHaveBeenCalledTimes(2);
	});

	it('sin retorno devuelve la suscripción relevante y el precio configurado', async () => {
		const server = createDbMock({ access_grants: [{ data: [], error: null }] });
		const admin = createDbMock({
			mp_subscriptions: [
				{
					data: [
						{ preapproval_id: 'pre-c', status: 'cancelled', payer_email: null, transaction_amount: null, next_charge_at: null, updated_at: null },
						{ preapproval_id: 'pre-a', status: 'authorized', payer_email: 'x@mail.com', transaction_amount: 50000, next_charge_at: null, updated_at: null }
					],
					error: null
				}
			]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([]);

		const data = (await load(makeEvent({ fetchMock }) as never)) as {
			mpSubscription: { preapproval_id: string } | null;
			mpAmount: number;
			mpReturn: unknown;
		};

		expect(requests).toHaveLength(0);
		// La autorizada le gana a la cancelada más nueva.
		expect(data.mpSubscription?.preapproval_id).toBe('pre-a');
		expect(data.mpAmount).toBe(50000);
		expect(data.mpReturn).toBeNull();
	});

	it('redirige a profesionales fuera de la página', async () => {
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext({ role: 'professional' }));
		const { fetchMock } = createMpFetch([]);

		await expect(load(makeEvent({ fetchMock }) as never)).rejects.toMatchObject({
			status: 303,
			location: '/odonto/mis-turnos'
		});
	});

	it('redirige una sesión de ayuda fuera de suscripción', async () => {
		const server = createDbMock();
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.resolveActiveBusiness.mockResolvedValue(assistedContext());
		const { fetchMock } = createMpFetch([]);

		await expect(load(makeEvent({ fetchMock }) as never)).rejects.toMatchObject({
			status: 303,
			location: '/odonto/configuracion/ayuda'
		});
	});
});

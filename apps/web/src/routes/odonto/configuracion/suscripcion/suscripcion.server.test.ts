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
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock('$lib/server/access/public/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness,
	demoBusinessContext: mocks.demoBusinessContext
}));
vi.mock('$lib/server/integrations/public/messaging', () => ({
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
			for (const method of ['select', 'eq', 'in', 'order', 'limit', 'upsert', 'update', 'insert', 'retry']) {
				q[method] = vi.fn(chain(method));
			}
			// Like the SDK, the single-row builder can be awaited or configured further.
			q.maybeSingle = vi.fn(() => q);
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
	// As hooks leaves it: the identity Auth verified for this request.
	locals: {
		auth: { access_token: 'token', refresh_token: 'r' },
		verifiedUser: { id: 'owner-1', email: 'duena@mail.com' }
	},
	fetch: opts.fetchMock,
	cookies: {},
	url: new URL(opts.url ?? PAGE_URL),
	request: new Request(PAGE_URL, {
		method: 'POST',
		// Lo que escribe el consultorio en «Correo de tu cuenta de Mercado Pago» (desde el 18-nov-2026 no se completa solo).
		body: new URLSearchParams(opts.formEntries ?? { payer_email: 'duena@mail.com' })
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
	it('sin el correo de Mercado Pago escrito no usa el de ingreso: lo pide y no llama a Mercado Pago', async () => {
		// El 18-nov-2026 se avanzó dos veces con el correo de ingreso propuesto y Mercado Pago no dejaba confirmar.
		const server = createDbMock();
		const admin = createDbMock({ mp_subscriptions: [{ data: [], error: null }, { error: null }] });
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock, formEntries: {} }) as never)) as { status: number; data: { message: string; payerEmail: string } };

		expect(result.status).toBe(400);
		expect(result.data.message).toBe('Escribí el correo de tu cuenta de Mercado Pago.');
		expect(result.data.payerEmail).toBe('');
		expect(requests).toHaveLength(0);
		expect(server.client.auth.getUser).not.toHaveBeenCalled();
	});

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
				transaction_amount: 90000,
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
			transaction_amount: 90000
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
			{}
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
						auto_recurring: { transaction_amount: 90000, currency_id: 'ARS' }
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
	type SubscriptionPage = { mpSubscription: unknown; mpSubscriptionUnavailable?: boolean; grants: unknown };

	it('dice que no pudo comprobar la suscripción en vez de ofrecer suscribirse cuando no pudo leerla', async () => {
		const server = createDbMock({ access_grants: [{ data: [], error: null }] });
		const admin = createDbMock({ mp_subscriptions: [{ data: null, error: { message: 'synthetic read failure' } }] });
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock } = createMpFetch([]);

		const data = (await load(makeEvent({ fetchMock }) as never)) as SubscriptionPage;

		expect(data).toMatchObject({ mpSubscription: null, mpSubscriptionUnavailable: true });
	});

	it('sin cliente de servicio tampoco presenta la suscripción como inexistente', async () => {
		const server = createDbMock({ access_grants: [{ data: [], error: null }] });
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockRejectedValue(new Error('synthetic unavailable admin client'));
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock } = createMpFetch([]);

		const data = (await load(makeEvent({ fetchMock }) as never)) as SubscriptionPage;

		expect(data).toMatchObject({ mpSubscription: null, mpSubscriptionUnavailable: true });
	});

	it('distingue un historial de pagos que no pudo leer de uno vacío', async () => {
		const server = createDbMock({ access_grants: [{ data: null, error: { message: 'synthetic read failure' } }] });
		const admin = createDbMock({ mp_subscriptions: [{ data: [], error: null }] });
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock } = createMpFetch([]);

		const data = (await load(makeEvent({ fetchMock }) as never)) as SubscriptionPage;

		expect(data).toMatchObject({ grants: null, mpSubscriptionUnavailable: false });
	});

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
			mpReturn: { subscriptionStatus: string | null; creditedNow: boolean; accessBlocked: boolean; provisionalUntil: string | null };
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
			accessBlocked: false,
			provisionalUntil: null
		});
		expect(data.mpSubscription?.status).toBe('authorized');
		// Tras acreditar se refresca el contexto para mostrar el acceso al día.
		expect(mocks.resolveActiveBusiness).toHaveBeenCalledTimes(2);
		expect(mocks.resolveActiveBusiness).toHaveBeenLastCalledWith(expect.objectContaining({ membershipCache: 'fresh' }));
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
		// que el webhook ya activó: una lectura nueva, no la de antes del pago que
		// el pedido ya tiene.
		expect(mocks.resolveActiveBusiness).toHaveBeenCalledTimes(2);
		expect(mocks.resolveActiveBusiness).toHaveBeenLastCalledWith(expect.objectContaining({ membershipCache: 'fresh' }));
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
		expect(data.mpAmount).toBe(90000);
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

describe('action subscribe: correo del pagador y fallas de Mercado Pago (18-nov-2026)', () => {
	const preparedOwner = (adminQueues: Record<string, Array<{ data?: unknown; error?: { message: string } | null }>>) => {
		const server = createDbMock();
		const admin = createDbMock(adminQueues);
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		return admin;
	};
	type Failure = { status: number; data: { message?: string; payerEmail?: string } };

	it('usa como pagador el correo de Mercado Pago que escribió el consultorio', async () => {
		preparedOwner({ mp_subscriptions: [{ data: [], error: null }, { error: null }] });
		const { fetchMock, requests } = createMpFetch([
			['/preapproval', { status: 201, body: { id: 'pre-9', status: 'pending', init_point: 'https://mp.test/init/pre-9' } }]
		]);

		await expect(
			actions.subscribe(makeEvent({ fetchMock, formEntries: { payer_email: ' Pagos@Mail.com ' } }) as never)
		).rejects.toMatchObject({ status: 303 });

		expect(requests[0].body).toMatchObject({ payer_email: 'pagos@mail.com' });
	});

	it('rechaza un correo con «+» sin pedirle nada a Mercado Pago', async () => {
		preparedOwner({});
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(
			makeEvent({ fetchMock, formEntries: { payer_email: 'duena+mp@mail.com' } }) as never
		)) as Failure;

		expect(result.status).toBe(400);
		expect(result.data.message).toContain('«+»');
		expect(result.data.payerEmail).toBe('duena+mp@mail.com');
		expect(requests).toHaveLength(0);
	});

	it('explica que Mercado Pago no aceptó el correo del pagador en lugar de pedir que se reintente', async () => {
		preparedOwner({ mp_subscriptions: [{ data: [], error: null }] });
		const { fetchMock } = createMpFetch([
			['/preapproval', { status: 400, method: 'POST', body: { message: 'User bad request', status: 400 } }]
		]);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as Failure;

		expect(result.status).toBe(400);
		expect(result.data.message).toContain('no aceptó «duena@mail.com»');
		expect(result.data.message).not.toContain('Probá de nuevo en unos minutos');
	});

	it('cancela la solicitud recién creada si no puede guardar su vínculo y no manda a pagar', async () => {
		preparedOwner({ mp_subscriptions: [{ data: [], error: null }, { error: { message: 'base caída' } }] });
		const { fetchMock, requests } = createMpFetch([
			['/preapproval/pre-9', { status: 200, method: 'PUT', body: { id: 'pre-9', status: 'cancelled' } }],
			['/preapproval', { status: 201, method: 'POST', body: { id: 'pre-9', status: 'pending', init_point: 'https://mp.test/init/pre-9' } }]
		]);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as Failure;

		expect(result.status).toBe(503);
		expect(requests.map((r) => [r.method, r.url.replace('https://api.mercadopago.com', '')])).toEqual([
			['POST', '/preapproval'],
			['PUT', '/preapproval/pre-9']
		]);
		expect(requests[1].body).toEqual({ status: 'cancelled' });
	});

	it('una solicitud pendiente que Mercado Pago ya no encuentra se marca y no bloquea', async () => {
		const admin = preparedOwner({
			mp_subscriptions: [
				{ data: [{ preapproval_id: 'pre-otro-entorno', status: 'pending', created_at: '2026-07-07T12:00:00.000Z' }], error: null },
				{ error: null },
				{ error: null }
			]
		});
		const { fetchMock } = createMpFetch([
			['/preapproval/pre-otro-entorno', { status: 404, method: 'GET', body: { message: 'not found' } }],
			['/preapproval', { status: 201, method: 'POST', body: { id: 'pre-nueva', status: 'pending', init_point: 'https://mp.test/init/pre-nueva' } }]
		]);

		await expect(actions.subscribe(makeEvent({ fetchMock }) as never)).rejects.toMatchObject({
			status: 303,
			location: 'https://mp.test/init/pre-nueva'
		});
		const marked = admin.calls.find((c) => c.table === 'mp_subscriptions' && c.method === 'update');
		expect(marked?.args[0]).toMatchObject({ status: 'not_found' });
	});
});

describe('precio fijo de quien ya contrató (decisión de Juan del 18-nov-2026)', () => {
	it('cobra el precio propio del consultorio en lugar del general', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			business_subscriptions: [{ data: { mp_price_ars: 75000 }, error: null }],
			mp_subscriptions: [{ data: [], error: null }, { error: null }]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock, requests } = createMpFetch([
			['/preapproval', { status: 201, body: { id: 'pre-fijo', status: 'pending', init_point: 'https://mp.test/init/pre-fijo' } }]
		]);

		await expect(actions.subscribe(makeEvent({ fetchMock }) as never)).rejects.toMatchObject({
			status: 303,
			location: 'https://mp.test/init/pre-fijo'
		});
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toMatchObject({ auto_recurring: { transaction_amount: 75000, currency_id: 'ARS' } });
		const upsert = admin.calls.find((c) => c.table === 'mp_subscriptions' && c.method === 'upsert');
		expect(upsert!.args[0]).toMatchObject({ preapproval_id: 'pre-fijo', transaction_amount: 75000 });
	});

	it('no reutiliza una solicitud pendiente con otro monto: la cancela y crea otra con el precio del consultorio', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			business_subscriptions: [{ data: { mp_price_ars: 100 }, error: null }],
			mp_subscriptions: [
				{ data: [{ preapproval_id: 'pre-viejo', status: 'pending', created_at: new Date().toISOString() }], error: null },
				{ error: null },
				{ error: null },
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
			id: 'pre-viejo',
			status: 'pending',
			external_reference: BUSINESS_ID,
			init_point: 'https://mp.test/init/pre-viejo',
			payer_email: 'duena@mail.com',
			auto_recurring: { transaction_amount: 90000, currency_id: 'ARS' }
		};
		const { fetchMock, requests } = createMpFetch([
			['/preapproval/pre-viejo', { method: 'GET', body: pending }],
			['/preapproval/pre-viejo', { method: 'PUT', body: { ...pending, status: 'cancelled' } }],
			['/preapproval', { method: 'POST', status: 201, body: { id: 'pre-nuevo', status: 'pending', init_point: 'https://mp.test/init/pre-nuevo' } }]
		]);

		await expect(actions.subscribe(makeEvent({ fetchMock }) as never)).rejects.toMatchObject({
			status: 303,
			location: 'https://mp.test/init/pre-nuevo'
		});
		expect(requests.map((request) => request.method)).toEqual(['GET', 'PUT', 'POST']);
		expect(requests[2].body).toMatchObject({ auto_recurring: { transaction_amount: 100 } });
	});

	it('no crea nada si no puede leer el precio del consultorio', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const server = createDbMock();
			const admin = createDbMock({
				business_subscriptions: [{ data: null, error: { message: 'sin conexión' } }],
				mp_subscriptions: [{ data: [], error: null }]
			});
			mocks.createSupabaseServerClient.mockResolvedValue(server.client);
			mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
			mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
			const { fetchMock, requests } = createMpFetch([]);

			const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as { status: number; data: { message?: string } };

			expect(result.status).toBe(503);
			expect(result.data.message).toContain('No se generó ningún cobro');
			expect(requests).toHaveLength(0);
		} finally {
			errorLog.mockRestore();
		}
	});

	it('la página muestra el precio propio y avisa que se conserva', async () => {
		const server = createDbMock({ access_grants: [{ data: [], error: null }] });
		const admin = createDbMock({
			business_subscriptions: [{ data: { mp_price_ars: 75000 }, error: null }],
			mp_subscriptions: [{ data: [], error: null }]
		});
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock } = createMpFetch([]);

		const data = (await load(makeEvent({ fetchMock }) as never)) as { mpAmount: number; mpPriceLocked: boolean };

		expect(data.mpAmount).toBe(75000);
		expect(data.mpPriceLocked).toBe(true);
	});

	it('sin precio propio la página muestra el general', async () => {
		const server = createDbMock({ access_grants: [{ data: [], error: null }] });
		const admin = createDbMock({ mp_subscriptions: [{ data: [], error: null }] });
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock } = createMpFetch([]);

		const data = (await load(makeEvent({ fetchMock }) as never)) as { mpAmount: number; mpPriceLocked: boolean };

		expect(data.mpAmount).toBe(90000);
		expect(data.mpPriceLocked).toBe(false);
	});
});

describe('plan pagado aparte (decisión de Juan del 18-nov-2026)', () => {
	it('no crea ninguna suscripción mientras el plan manual está vigente', async () => {
		const server = createDbMock();
		const admin = createDbMock({ mp_subscriptions: [{ data: [], error: null }] });
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const context = ownerContext();
		mocks.resolveActiveBusiness.mockResolvedValue({
			...context,
			access: { ...context.access, subscription: { access_source: 'manual' } }
		});
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.subscribe(makeEvent({ fetchMock }) as never)) as { status: number; data: { message?: string } };

		expect(result.status).toBe(409);
		expect(result.data.message).toContain('Tu plan ya está pago');
		expect(requests).toHaveLength(0);
		expect(admin.client.from).not.toHaveBeenCalled();
	});

	it('vencido el plan manual, permite suscribirse', async () => {
		const server = createDbMock();
		const admin = createDbMock({ mp_subscriptions: [{ data: [], error: null }, { error: null }] });
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const context = ownerContext({ commercialStatus: 'grace' });
		mocks.resolveActiveBusiness.mockResolvedValue({
			...context,
			access: { ...context.access, subscription: { access_source: 'manual' } }
		});
		const { fetchMock } = createMpFetch([
			['/preapproval', { status: 201, body: { id: 'pre-renovar', status: 'pending', init_point: 'https://mp.test/init/pre-renovar' } }]
		]);

		await expect(actions.subscribe(makeEvent({ fetchMock }) as never)).rejects.toMatchObject({
			status: 303,
			location: 'https://mp.test/init/pre-renovar'
		});
	});
});

describe('solicitud pendiente con otro pagador (18-nov-2026)', () => {
	it('no la reutiliza: Mercado Pago sólo deja pagar con su correo; la cancela y crea otra con el correo escrito', async () => {
		const server = createDbMock();
		const admin = createDbMock({
			mp_subscriptions: [
				{ data: [{ preapproval_id: 'pre-otro-pagador', status: 'pending', created_at: new Date().toISOString() }], error: null },
				{ error: null },
				{ error: null },
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
			id: 'pre-otro-pagador',
			status: 'pending',
			external_reference: BUSINESS_ID,
			init_point: 'https://mp.test/init/pre-otro-pagador',
			payer_email: 'otra-cuenta@mail.com',
			auto_recurring: { transaction_amount: 90000, currency_id: 'ARS' }
		};
		const { fetchMock, requests } = createMpFetch([
			['/preapproval/pre-otro-pagador', { method: 'GET', body: pending }],
			['/preapproval/pre-otro-pagador', { method: 'PUT', body: { ...pending, status: 'cancelled' } }],
			['/preapproval', { method: 'POST', status: 201, body: { id: 'pre-pagador-nuevo', status: 'pending', init_point: 'https://mp.test/init/pre-pagador-nuevo' } }]
		]);

		await expect(
			actions.subscribe(makeEvent({ fetchMock, formEntries: { payer_email: 'pagadora@mail.com' } }) as never)
		).rejects.toMatchObject({ status: 303, location: 'https://mp.test/init/pre-pagador-nuevo' });
		expect(requests.map((request) => request.method)).toEqual(['GET', 'PUT', 'POST']);
		expect(requests[2].body).toMatchObject({ payer_email: 'pagadora@mail.com' });
	});
});

describe('rechazos de Mercado Pago al crear la suscripción (18-nov-2026)', () => {
	const rejectWith = async (status: number, body: Record<string, unknown>) => {
		const server = createDbMock();
		const admin = createDbMock({ mp_subscriptions: [{ data: [], error: null }] });
		mocks.createSupabaseServerClient.mockResolvedValue(server.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());
		const { fetchMock } = createMpFetch([['/preapproval', { method: 'POST', status, body }]]);
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const result = (await actions.subscribe(
				makeEvent({ fetchMock, formEntries: { payer_email: 'pagadora@mail.com' } }) as never
			)) as { status: number; data: { message: string; payerEmail: string } };
			return { result, logs: errorLog.mock.calls.map((call) => String(call[0])) };
		} finally {
			errorLog.mockRestore();
		}
	};

	it('un rechazo sin categoría conocida conserva el correo escrito y no guarda el texto de Mercado Pago', async () => {
		const { result, logs } = await rejectWith(400, { message: 'texto con pagadora@mail.com', error: 'bad_request', status: 400, cause: [{ code: 1234, description: 'algo' }] });
		expect(result.status).toBe(502);
		expect(result.data.payerEmail).toBe('pagadora@mail.com');
		expect(result.data.message).toContain('No se generó ningún cobro');
		expect(logs).toContain('Mercado Pago rechazó el preapproval: other (códigos 1234)');
		expect(logs.join(' ')).not.toContain('pagadora@mail.com');
	});

	it('si el pagador es la cuenta que cobra, lo dice en palabras simples', async () => {
		const { result, logs } = await rejectWith(400, { message: 'Payer and collector cannot be the same user', error: 'bad_request', status: 400 });
		expect(result.status).toBe(400);
		expect(result.data.message).toContain('es el correo de la cuenta de Mercado Pago que cobra Cita Suite');
		expect(result.data.payerEmail).toBe('pagadora@mail.com');
		expect(logs).toContain('Mercado Pago rechazó el preapproval: payer_is_seller');
	});

	it('un monto que Mercado Pago no acepta se informa como tal', async () => {
		const { result, logs } = await rejectWith(400, { message: 'Cannot pay an amount lower than $ 15.00', error: 'bad_request', status: 400 });
		expect(result.status).toBe(502);
		expect(result.data.message).toContain('no aceptó el monto');
		expect(logs).toContain('Mercado Pago rechazó el preapproval: amount');
	});

	it('el pagador que Mercado Pago no reconoce sigue con su mensaje propio', async () => {
		const { result } = await rejectWith(400, { message: 'User bad request', error: 'bad_request', status: 400 });
		expect(result.status).toBe(400);
		expect(result.data.message).toContain('Mercado Pago no aceptó «pagadora@mail.com» como correo del pagador');
	});
});

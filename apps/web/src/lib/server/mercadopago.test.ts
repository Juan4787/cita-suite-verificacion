import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));

import {
	buildSignatureManifest,
	confirmMpSubscriptionForBusiness,
	creditApprovedPayment,
	getMercadoPagoApiConfigIssue,
	getMercadoPagoEnvironment,
	getSubscriptionAmountArs,
	logMpWebhookEvent,
	logMpWebhookEventOnce,
	MP_PAYMENT_IDEMPOTENCY_PREFIX,
	parseSignatureHeader,
	pickRelevantMpSubscription,
	processMpWebhookEvent,
	reconcileMercadoPago,
	recordCancelledPayment,
	SUBSCRIPTION_DURATION_SECONDS,
	verifyMpWebhookSignature
} from './mercadopago';

const SECRET = 'clave-secreta-de-prueba';
const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

// Reloj fijo inyectado en las verificaciones de firma para que la frescura del
// ts sea determinística.
const NOW_MS = 1_751_630_400_000;
const FRESH_TS = String(Math.floor(NOW_MS / 1000));

const signManifest = (manifest: string, secret = SECRET) =>
	crypto.createHmac('sha256', secret).update(manifest, 'utf8').digest('hex');

type QueuedResult = { data: unknown; error: { message: string } | null };

// Mock de cliente admin. Las colas por tabla se consumen primero; agotadas,
// cada tabla cae a un default que representa el caso feliz (negocio existente,
// no permanente, sin mapeo previo de suscripción).
const TABLE_DEFAULTS: Record<string, QueuedResult> = {
	businesses: { data: { id: BUSINESS_ID }, error: null },
	business_subscriptions: { data: { is_permanent: false }, error: null },
	mp_subscriptions: { data: null, error: null }
};

const createAdminMock = (opts?: {
	rpcQueue?: Array<{ data?: unknown; error?: { message: string } | null }>;
	tables?: Record<string, QueuedResult[]>;
	upsertError?: { message: string } | null;
	insertError?: { message: string } | null;
}) => {
	const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
	const upsertCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];
	const insertCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];
	const updateCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];
	const rpcQueue = [...(opts?.rpcQueue ?? [])];
	const tableQueues: Record<string, QueuedResult[]> = {};
	for (const [table, queue] of Object.entries(opts?.tables ?? {})) {
		tableQueues[table] = [...queue];
	}
	const admin = {
		rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
			rpcCalls.push({ fn, args });
			return (
				rpcQueue.shift() ?? {
					data: [{ applied: true, grant_id: 'grant-1', status_after: 'active' }],
					error: null
				}
			);
		}),
		// Cada from() consume una respuesta encolada para esa tabla (o cae al
		// default feliz); cualquier cadena select/eq/in/order/limit se puede
		// await-ear y resuelve esa respuesta.
		from: vi.fn((table: string) => {
			const result =
				tableQueues[table]?.shift() ?? TABLE_DEFAULTS[table] ?? { data: null, error: null };
			const q: Record<string, unknown> = {};
			for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
				q[method] = vi.fn(() => q);
			}
			q.maybeSingle = vi.fn(async () => result);
			q.update = vi.fn((payload: Record<string, unknown>) => {
				updateCalls.push({ table, payload });
				return q;
			});
			q.upsert = vi.fn(async (payload: Record<string, unknown>) => {
				upsertCalls.push({ table, payload });
				return { error: opts?.upsertError ?? null };
			});
			q.insert = vi.fn(async (payload: Record<string, unknown>) => {
				insertCalls.push({ table, payload });
				return { error: opts?.insertError ?? null };
			});
			(q as { then?: unknown }).then = (
				resolve: (value: unknown) => unknown,
				reject: (reason: unknown) => unknown
			) => Promise.resolve(result).then(resolve, reject);
			return q;
		})
	};
	return { admin: admin as never, rpcCalls, upsertCalls, insertCalls, updateCalls };
};

const createFetchMock = (routes: Array<[string, { status?: number; body?: unknown }]>) => {
	const calls: string[] = [];
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		calls.push(url);
		const hit = routes.find(([fragment]) => url.includes(fragment));
		if (!hit) return new Response('{}', { status: 404 });
		return new Response(JSON.stringify(hit[1].body ?? {}), { status: hit[1].status ?? 200 });
	});
	return { fetchMock: fetchMock as unknown as typeof fetch, calls };
};

beforeEach(() => {
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	envState.privateEnv.MP_ACCESS_TOKEN = 'token-de-prueba';
	envState.privateEnv.MP_WEBHOOK_SECRET = SECRET;
	envState.privateEnv.MP_ENVIRONMENT = 'test';
});

describe('parseSignatureHeader', () => {
	it('extrae ts y v1 de un header válido', () => {
		expect(parseSignatureHeader('ts=1704908010,v1=abc123')).toEqual({
			ts: '1704908010',
			v1: 'abc123'
		});
	});

	it('tolera espacios alrededor de los segmentos', () => {
		expect(parseSignatureHeader(' ts=1 , v1=deadbeef ')).toEqual({ ts: '1', v1: 'deadbeef' });
	});

	it('devuelve null si falta v1, si falta ts o si el header es nulo', () => {
		expect(parseSignatureHeader('ts=1704908010')).toBeNull();
		expect(parseSignatureHeader('v1=abc')).toBeNull();
		expect(parseSignatureHeader(null)).toBeNull();
		expect(parseSignatureHeader('basura-total')).toBeNull();
	});
});

describe('buildSignatureManifest', () => {
	it('arma el manifest oficial completo', () => {
		expect(
			buildSignatureManifest({ dataId: '123', requestId: 'req-abc', ts: '1704908010' })
		).toBe('id:123;request-id:req-abc;ts:1704908010;');
	});

	it('convierte data.id alfanumérico a minúsculas (ejemplo oficial de la doc)', () => {
		expect(
			buildSignatureManifest({
				dataId: 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3',
				requestId: 'req-1',
				ts: '99'
			})
		).toBe('id:ord01jq4s4ky8hwq6na5pxb65b3d3;request-id:req-1;ts:99;');
	});

	it('omite entero el segmento id cuando no llegó data.id', () => {
		expect(buildSignatureManifest({ dataId: null, requestId: 'req-1', ts: '99' })).toBe(
			'request-id:req-1;ts:99;'
		);
	});

	it('omite entero el segmento request-id cuando no llegó el header', () => {
		expect(buildSignatureManifest({ dataId: '123', requestId: null, ts: '99' })).toBe(
			'id:123;ts:99;'
		);
	});
});

describe('verifyMpWebhookSignature', () => {
	it('acepta una firma HMAC-SHA256 correcta y fresca', () => {
		const v1 = signManifest(`id:123;request-id:req-1;ts:${FRESH_TS};`);
		expect(
			verifyMpWebhookSignature(
				{
					signatureHeader: `ts=${FRESH_TS},v1=${v1}`,
					requestId: 'req-1',
					dataId: '123'
				},
				NOW_MS
			)
		).toBe(true);
	});

	it('acepta ts en milisegundos', () => {
		const tsMs = String(NOW_MS - 30_000);
		const v1 = signManifest(`id:123;ts:${tsMs};`);
		expect(
			verifyMpWebhookSignature(
				{ signatureHeader: `ts=${tsMs},v1=${v1}`, requestId: null, dataId: '123' },
				NOW_MS
			)
		).toBe(true);
	});

	it('verifica con data.id en minúsculas aunque llegue en mayúsculas', () => {
		const v1 = signManifest(`id:ord01abc;request-id:req-9;ts:${FRESH_TS};`);
		expect(
			verifyMpWebhookSignature(
				{
					signatureHeader: `ts=${FRESH_TS},v1=${v1}`,
					requestId: 'req-9',
					dataId: 'ORD01ABC'
				},
				NOW_MS
			)
		).toBe(true);
	});

	it('rechaza una firma con ts viejo aunque el HMAC sea correcto (anti-replay)', () => {
		const staleTs = String(Math.floor(NOW_MS / 1000) - 1200);
		const v1 = signManifest(`id:123;ts:${staleTs};`);
		expect(
			verifyMpWebhookSignature(
				{ signatureHeader: `ts=${staleTs},v1=${v1}`, requestId: null, dataId: '123' },
				NOW_MS
			)
		).toBe(false);
	});

	it('rechaza ts no numérico', () => {
		const v1 = signManifest('id:123;ts:ayer;');
		expect(
			verifyMpWebhookSignature(
				{ signatureHeader: `ts=ayer,v1=${v1}`, requestId: null, dataId: '123' },
				NOW_MS
			)
		).toBe(false);
	});

	it('rechaza una firma incorrecta', () => {
		expect(
			verifyMpWebhookSignature(
				{
					signatureHeader: `ts=${FRESH_TS},v1=${'0'.repeat(64)}`,
					requestId: 'req-1',
					dataId: '123'
				},
				NOW_MS
			)
		).toBe(false);
	});

	it('falla-cerrado sin MP_WEBHOOK_SECRET configurado', () => {
		delete envState.privateEnv.MP_WEBHOOK_SECRET;
		const v1 = signManifest(`id:123;ts:${FRESH_TS};`);
		expect(
			verifyMpWebhookSignature(
				{ signatureHeader: `ts=${FRESH_TS},v1=${v1}`, requestId: null, dataId: '123' },
				NOW_MS
			)
		).toBe(false);
	});

	it('rechaza headers malformados o ausentes', () => {
		expect(
			verifyMpWebhookSignature({ signatureHeader: null, requestId: null, dataId: '1' }, NOW_MS)
		).toBe(false);
		expect(
			verifyMpWebhookSignature(
				{ signatureHeader: 'v1=solo', requestId: null, dataId: '1' },
				NOW_MS
			)
		).toBe(false);
	});
});

describe('creditApprovedPayment', () => {
	it('llama a grant_business_access con la clave idempotente y el payload correcto', async () => {
		const { admin, rpcCalls } = createAdminMock();
		const result = await creditApprovedPayment(admin, {
			businessId: BUSINESS_ID,
			paymentId: '987654',
			amount: 50000,
			origin: 'webhook'
		});
		expect(result).toEqual({ kind: 'credited', grantId: 'grant-1', statusAfter: 'active' });
		expect(rpcCalls).toHaveLength(1);
		expect(rpcCalls[0].fn).toBe('grant_business_access');
		expect(rpcCalls[0].args).toMatchObject({
			p_business_id: BUSINESS_ID,
			p_operation: 'payment_registered',
			p_duration_seconds: SUBSCRIPTION_DURATION_SECONDS,
			p_duration_unit: 'month',
			p_is_permanent: false,
			p_amount: 50000,
			p_source: 'mercado_pago',
			p_admin_id: null,
			p_admin_email: null,
			p_idempotency_key: `${MP_PAYMENT_IDEMPOTENCY_PREFIX}987654`
		});
	});

	it('reporta duplicado cuando la clave ya estaba acreditada (applied=false)', async () => {
		const { admin } = createAdminMock({
			rpcQueue: [
				{ data: [{ applied: false, grant_id: 'grant-viejo', status_after: 'active' }], error: null }
			]
		});
		const result = await creditApprovedPayment(admin, {
			businessId: BUSINESS_ID,
			paymentId: '987654',
			amount: null,
			origin: 'retorno'
		});
		expect(result).toEqual({ kind: 'duplicated', grantId: 'grant-viejo', statusAfter: 'active' });
	});

	it('no acredita a un negocio inexistente (sin llamar a la RPC)', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: { businesses: [{ data: null, error: null }] }
		});
		const result = await creditApprovedPayment(admin, {
			businessId: BUSINESS_ID,
			paymentId: '1',
			amount: null,
			origin: 'webhook'
		});
		expect(result).toEqual({ kind: 'skipped', reason: 'unknown_business' });
		expect(rpcCalls).toHaveLength(0);
	});

	it('no acredita a un negocio permanente (sin llamar a la RPC)', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: { business_subscriptions: [{ data: { is_permanent: true }, error: null }] }
		});
		const result = await creditApprovedPayment(admin, {
			businessId: BUSINESS_ID,
			paymentId: '1',
			amount: null,
			origin: 'webhook'
		});
		expect(result).toEqual({ kind: 'skipped', reason: 'permanent_business' });
		expect(rpcCalls).toHaveLength(0);
	});

	it('lanza si la RPC devuelve error', async () => {
		const { admin } = createAdminMock({
			rpcQueue: [{ data: null, error: { message: 'boom' } }]
		});
		await expect(
			creditApprovedPayment(admin, {
				businessId: BUSINESS_ID,
				paymentId: '1',
				amount: null,
				origin: 'webhook'
			})
		).rejects.toThrow('boom');
	});
});

describe('recordCancelledPayment', () => {
	it('registra el asiento con la clave :cancelled sin duración', async () => {
		const { admin, rpcCalls } = createAdminMock();
		const result = await recordCancelledPayment(admin, {
			businessId: BUSINESS_ID,
			paymentId: '444',
			amount: 50000,
			status: 'refunded'
		});
		expect(result.kind).toBe('credited');
		expect(rpcCalls[0].args).toMatchObject({
			p_operation: 'payment_cancelled',
			p_duration_seconds: null,
			p_duration_unit: null,
			p_idempotency_key: 'mp:payment:444:cancelled'
		});
	});

	it('no registra asientos para negocios inexistentes', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: { businesses: [{ data: null, error: null }] }
		});
		const result = await recordCancelledPayment(admin, {
			businessId: BUSINESS_ID,
			paymentId: '444',
			amount: null,
			status: 'refunded'
		});
		expect(result).toEqual({ kind: 'skipped', reason: 'unknown_business' });
		expect(rpcCalls).toHaveLength(0);
	});
});

describe('processMpWebhookEvent: topic payment', () => {
	it('acredita un pago aprobado con external_reference válido', async () => {
		const { admin, rpcCalls } = createAdminMock();
		const { fetchMock } = createFetchMock([
			[
				'/v1/payments/111',
				{
					body: {
						id: 111,
						status: 'approved',
						external_reference: BUSINESS_ID,
						transaction_amount: 50000
					}
				}
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '111'
		});
		expect(result.status).toBe('processed');
		expect(result.businessId).toBe(BUSINESS_ID);
		expect(result.grantId).toBe('grant-1');
		expect(result.requiresAttention).toBe(false);
		expect(rpcCalls[0].args.p_idempotency_key).toBe('mp:payment:111');
		expect(rpcCalls[0].args.p_amount).toBe(50000);
	});

	it('alerta cuando el pago se acredita pero el negocio sigue bloqueado (override manual)', async () => {
		const { admin } = createAdminMock({
			rpcQueue: [
				{
					data: [{ applied: true, grant_id: 'grant-2', status_after: 'restricted' }],
					error: null
				}
			]
		});
		const { fetchMock } = createFetchMock([
			[
				'/v1/payments/118',
				{ body: { id: 118, status: 'approved', external_reference: BUSINESS_ID } }
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '118'
		});
		expect(result.status).toBe('processed');
		expect(result.requiresAttention).toBe(true);
		expect(result.detail).toContain('restricted');
	});

	it('usa metadata.business_id como respaldo de mapeo', async () => {
		const { admin, rpcCalls } = createAdminMock();
		const { fetchMock } = createFetchMock([
			[
				'/v1/payments/112',
				{
					body: {
						id: 112,
						status: 'approved',
						external_reference: null,
						metadata: { business_id: BUSINESS_ID },
						transaction_amount: 50000
					}
				}
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '112'
		});
		expect(result.status).toBe('processed');
		expect(rpcCalls).toHaveLength(1);
	});

	it('marca atención cuando un pago aprobado no mapea a ningún negocio', async () => {
		const { admin, rpcCalls } = createAdminMock();
		const { fetchMock } = createFetchMock([
			['/v1/payments/113', { body: { id: 113, status: 'approved', external_reference: 'no-uuid' } }]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '113'
		});
		expect(result.status).toBe('skipped');
		expect(result.requiresAttention).toBe(true);
		expect(rpcCalls).toHaveLength(0);
	});

	it('marca atención cuando el negocio referenciado no existe (sin loop de reintentos)', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: { businesses: [{ data: null, error: null }] }
		});
		const { fetchMock } = createFetchMock([
			[
				'/v1/payments/119',
				{ body: { id: 119, status: 'approved', external_reference: BUSINESS_ID } }
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '119'
		});
		expect(result.status).toBe('skipped');
		expect(result.requiresAttention).toBe(true);
		expect(rpcCalls).toHaveLength(0);
	});

	it('registra reembolsos como payment_cancelled sin tocar el acceso y pide atención', async () => {
		const { admin, rpcCalls } = createAdminMock();
		const { fetchMock } = createFetchMock([
			[
				'/v1/payments/114',
				{
					body: {
						id: 114,
						status: 'refunded',
						external_reference: BUSINESS_ID,
						transaction_amount: 50000
					}
				}
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '114'
		});
		expect(result.status).toBe('processed');
		expect(result.requiresAttention).toBe(true);
		expect(rpcCalls[0].args).toMatchObject({
			p_operation: 'payment_cancelled',
			p_duration_seconds: null,
			p_idempotency_key: 'mp:payment:114:cancelled'
		});
	});

	it('ignora pagos cancelled (nunca aprobados): ni asiento ni alerta', async () => {
		const { admin, rpcCalls } = createAdminMock();
		const { fetchMock } = createFetchMock([
			[
				'/v1/payments/117',
				{ body: { id: 117, status: 'cancelled', external_reference: BUSINESS_ID } }
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '117'
		});
		expect(result.status).toBe('skipped');
		expect(result.requiresAttention).toBe(false);
		expect(rpcCalls).toHaveLength(0);
	});

	it('ignora estados intermedios sin pedir atención', async () => {
		const { admin, rpcCalls } = createAdminMock();
		const { fetchMock } = createFetchMock([
			['/v1/payments/115', { body: { id: 115, status: 'pending', external_reference: BUSINESS_ID } }]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '115'
		});
		expect(result.status).toBe('skipped');
		expect(result.requiresAttention).toBe(false);
		expect(rpcCalls).toHaveLength(0);
	});

	it('marca atención ante un 404 de la API (test/prod cruzado) sin pedir reintento', async () => {
		const { admin } = createAdminMock();
		const { fetchMock } = createFetchMock([['/v1/payments/116', { status: 404, body: {} }]]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '116'
		});
		expect(result.status).toBe('skipped');
		expect(result.requiresAttention).toBe(true);
	});

	it('convierte un 500 de la API en error para forzar el reintento de MP', async () => {
		const { admin } = createAdminMock();
		const { fetchMock } = createFetchMock([['/v1/payments/120', { status: 500, body: {} }]]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '120'
		});
		expect(result.status).toBe('error');
	});

	it('convierte un 429 de la API en error para forzar el reintento de MP', async () => {
		const { admin } = createAdminMock();
		const { fetchMock } = createFetchMock([['/v1/payments/121', { status: 429, body: {} }]]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '121'
		});
		expect(result.status).toBe('error');
	});
});

describe('processMpWebhookEvent: topic subscription_authorized_payment', () => {
	it('acredita con el id del pago usando el mapeo local por preapproval', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [{ data: { business_id: BUSINESS_ID }, error: null }]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/authorized_payments/200',
				{
					body: {
						id: 200,
						preapproval_id: 'pre-1',
						status: 'processed',
						transaction_amount: 50000,
						payment: { id: 555, status: 'approved' }
					}
				}
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'subscription_authorized_payment',
			resourceId: '200'
		});
		expect(result.status).toBe('processed');
		expect(result.businessId).toBe(BUSINESS_ID);
		expect(rpcCalls[0].args.p_idempotency_key).toBe('mp:payment:555');
	});

	it('reconstruye el mapeo desde el preapproval cuando no hay fila local', async () => {
		const { admin, rpcCalls, upsertCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [{ data: null, error: null }]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/authorized_payments/201',
				{
					body: {
						id: 201,
						preapproval_id: 'pre-2',
						transaction_amount: 50000,
						payment: { id: 556, status: 'approved' }
					}
				}
			],
			[
				'/preapproval/pre-2',
				{
					body: {
						id: 'pre-2',
						status: 'authorized',
						external_reference: BUSINESS_ID,
						payer_email: 'clienta@mail.com'
					}
				}
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'subscription_authorized_payment',
			resourceId: '201'
		});
		expect(result.status).toBe('processed');
		expect(result.businessId).toBe(BUSINESS_ID);
		expect(upsertCalls).toHaveLength(1);
		expect(upsertCalls[0].table).toBe('mp_subscriptions');
		expect(rpcCalls[0].args.p_idempotency_key).toBe('mp:payment:556');
	});

	it('pide atención si el cobro está aprobado pero MP no informa id de pago', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [{ data: { business_id: BUSINESS_ID }, error: null }]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/authorized_payments/203',
				{
					body: {
						id: 203,
						preapproval_id: 'pre-1',
						payment: { status: 'approved' }
					}
				}
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'subscription_authorized_payment',
			resourceId: '203'
		});
		expect(result.status).toBe('skipped');
		expect(result.requiresAttention).toBe(true);
		expect(rpcCalls).toHaveLength(0);
	});

	it('no acredita cobros no aprobados', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [{ data: { business_id: BUSINESS_ID }, error: null }]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/authorized_payments/202',
				{
					body: {
						id: 202,
						preapproval_id: 'pre-1',
						payment: { id: 557, status: 'rejected' }
					}
				}
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'subscription_authorized_payment',
			resourceId: '202'
		});
		expect(result.status).toBe('skipped');
		expect(rpcCalls).toHaveLength(0);
	});
});

describe('processMpWebhookEvent: topic subscription_preapproval', () => {
	it('sincroniza la suscripción y no pide atención cuando queda autorizada', async () => {
		const { admin, upsertCalls } = createAdminMock();
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-3',
				{
					body: {
						id: 'pre-3',
						status: 'authorized',
						external_reference: BUSINESS_ID,
						payer_email: 'clienta@mail.com',
						next_payment_date: '2026-08-04T12:00:00.000Z',
						auto_recurring: { transaction_amount: 50000, currency_id: 'ARS' }
					}
				}
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'subscription_preapproval',
			resourceId: 'pre-3'
		});
		expect(result.status).toBe('processed');
		expect(result.requiresAttention).toBe(false);
		expect(upsertCalls[0].payload).toMatchObject({
			business_id: BUSINESS_ID,
			preapproval_id: 'pre-3',
			status: 'authorized',
			transaction_amount: 50000
		});
	});

	it('pide atención cuando la suscripción queda cancelada', async () => {
		const { admin } = createAdminMock();
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-4',
				{ body: { id: 'pre-4', status: 'cancelled', external_reference: BUSINESS_ID } }
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'subscription_preapproval',
			resourceId: 'pre-4'
		});
		expect(result.status).toBe('processed');
		expect(result.requiresAttention).toBe(true);
	});

	it('pide atención si external_reference no es un negocio válido', async () => {
		const { admin, upsertCalls } = createAdminMock();
		const { fetchMock } = createFetchMock([
			['/preapproval/pre-5', { body: { id: 'pre-5', status: 'authorized', external_reference: 'x' } }]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'subscription_preapproval',
			resourceId: 'pre-5'
		});
		expect(result.status).toBe('skipped');
		expect(result.requiresAttention).toBe(true);
		expect(upsertCalls).toHaveLength(0);
	});

	it('pide atención si el negocio referenciado no existe', async () => {
		const { admin, upsertCalls } = createAdminMock({
			tables: { businesses: [{ data: null, error: null }] }
		});
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-6',
				{ body: { id: 'pre-6', status: 'authorized', external_reference: BUSINESS_ID } }
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'subscription_preapproval',
			resourceId: 'pre-6'
		});
		expect(result.status).toBe('skipped');
		expect(result.requiresAttention).toBe(true);
		expect(upsertCalls).toHaveLength(0);
	});
});

describe('processMpWebhookEvent: casos generales', () => {
	it('ignora topics desconocidos', async () => {
		const { admin } = createAdminMock();
		const { fetchMock, calls } = createFetchMock([]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'plan_desconocido',
			resourceId: '1'
		});
		expect(result.status).toBe('skipped');
		expect(result.requiresAttention).toBe(false);
		expect(calls).toHaveLength(0);
	});

	it('ignora notificaciones sin data.id', async () => {
		const { admin } = createAdminMock();
		const { fetchMock } = createFetchMock([]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: null
		});
		expect(result.status).toBe('skipped');
	});

	it('convierte errores de acreditación en status error con atención', async () => {
		const { admin } = createAdminMock({
			rpcQueue: [{ data: null, error: { message: 'db caída' } }]
		});
		const { fetchMock } = createFetchMock([
			[
				'/v1/payments/300',
				{ body: { id: 300, status: 'approved', external_reference: BUSINESS_ID } }
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '300'
		});
		expect(result.status).toBe('error');
		expect(result.requiresAttention).toBe(true);
		expect(result.detail).toContain('db caída');
	});

	it('trata al negocio permanente como skipped con atención (sin reintentos)', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: { business_subscriptions: [{ data: { is_permanent: true }, error: null }] }
		});
		const { fetchMock } = createFetchMock([
			[
				'/v1/payments/301',
				{ body: { id: 301, status: 'approved', external_reference: BUSINESS_ID } }
			]
		]);
		const result = await processMpWebhookEvent(admin, fetchMock, {
			topic: 'payment',
			resourceId: '301'
		});
		expect(result.status).toBe('skipped');
		expect(result.requiresAttention).toBe(true);
		expect(rpcCalls).toHaveLength(0);
	});
});

describe('getSubscriptionAmountArs', () => {
	it('usa el env cuando es un monto válido y cae a 50000 en cualquier otro caso', () => {
		envState.privateEnv.MP_SUBSCRIPTION_AMOUNT_ARS = '65000';
		expect(getSubscriptionAmountArs()).toBe(65000);
		envState.privateEnv.MP_SUBSCRIPTION_AMOUNT_ARS = ' 70000 ';
		expect(getSubscriptionAmountArs()).toBe(70000);
		envState.privateEnv.MP_SUBSCRIPTION_AMOUNT_ARS = '0';
		expect(getSubscriptionAmountArs()).toBe(50000);
		envState.privateEnv.MP_SUBSCRIPTION_AMOUNT_ARS = '-5';
		expect(getSubscriptionAmountArs()).toBe(50000);
		envState.privateEnv.MP_SUBSCRIPTION_AMOUNT_ARS = 'abc';
		expect(getSubscriptionAmountArs()).toBe(50000);
		delete envState.privateEnv.MP_SUBSCRIPTION_AMOUNT_ARS;
		expect(getSubscriptionAmountArs()).toBe(50000);
	});
});

describe('Mercado Pago environment', () => {
	it('uses the explicit environment and supports the legacy TEST subscription token', () => {
		envState.privateEnv.MP_ACCESS_TOKEN = 'APP_USR-example';
		envState.privateEnv.MP_ENVIRONMENT = 'test';
		expect(getMercadoPagoEnvironment()).toBe('test');
		expect(getMercadoPagoApiConfigIssue()).toBeNull();

		delete envState.privateEnv.MP_ENVIRONMENT;
		envState.privateEnv.MP_ACCESS_TOKEN = 'TEST-example';
		expect(getMercadoPagoEnvironment()).toBe('test');
		expect(getMercadoPagoApiConfigIssue()).toBeNull();
	});

	it('rejects an invalid environment or a TEST token declared as production', () => {
		envState.privateEnv.MP_ACCESS_TOKEN = 'APP_USR-example';
		envState.privateEnv.MP_ENVIRONMENT = 'staging';
		expect(getMercadoPagoApiConfigIssue()).toBe('MP_ENVIRONMENT');

		envState.privateEnv.MP_ACCESS_TOKEN = 'TEST-example';
		envState.privateEnv.MP_ENVIRONMENT = 'production';
		expect(getMercadoPagoApiConfigIssue()).toBe('MP_ENVIRONMENT');

		delete envState.privateEnv.MP_ENVIRONMENT;
		envState.privateEnv.MP_ACCESS_TOKEN = 'APP_USR-example';
		expect(getMercadoPagoApiConfigIssue()).toBe('MP_ENVIRONMENT');
	});
});

describe('confirmMpSubscriptionForBusiness (retorno)', () => {
	it('sincroniza el preapproval autorizado y acredita su cobro aprobado', async () => {
		const { admin, rpcCalls, upsertCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [
					{ data: [{ preapproval_id: 'pre-r', status: 'pending' }], error: null }
				]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-r',
				{ body: { id: 'pre-r', status: 'authorized', external_reference: BUSINESS_ID } }
			],
			[
				'/authorized_payments/search',
				{
					body: {
						results: [{ id: 70, transaction_amount: 50000, payment: { id: 701, status: 'approved' } }]
					}
				}
			]
		]);

		const summary = await confirmMpSubscriptionForBusiness(admin, fetchMock, BUSINESS_ID);

		expect(summary).toEqual({
			subscriptionStatus: 'authorized',
			creditedNow: true,
			accessBlocked: false
		});
		expect(upsertCalls.some((c) => c.table === 'mp_subscriptions')).toBe(true);
		expect(rpcCalls[0].args.p_idempotency_key).toBe('mp:payment:701');
	});

	it('reporta pending sin buscar cobros cuando la autorización no se completó', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [
					{ data: [{ preapproval_id: 'pre-p', status: 'pending' }], error: null }
				]
			}
		});
		const { fetchMock, calls } = createFetchMock([
			[
				'/preapproval/pre-p',
				{ body: { id: 'pre-p', status: 'pending', external_reference: BUSINESS_ID } }
			]
		]);

		const summary = await confirmMpSubscriptionForBusiness(admin, fetchMock, BUSINESS_ID);

		expect(summary).toEqual({
			subscriptionStatus: 'pending',
			creditedNow: false,
			accessBlocked: false
		});
		expect(rpcCalls).toHaveLength(0);
		expect(calls.some((url) => url.includes('/authorized_payments/search'))).toBe(false);
	});

	it('marca accessBlocked cuando el pago quedó acreditado pero el negocio sigue bloqueado', async () => {
		const { admin } = createAdminMock({
			rpcQueue: [
				{
					data: [{ applied: false, grant_id: 'grant-w', status_after: 'restricted' }],
					error: null
				}
			],
			tables: {
				mp_subscriptions: [
					{ data: [{ preapproval_id: 'pre-b', status: 'authorized' }], error: null }
				]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-b',
				{ body: { id: 'pre-b', status: 'authorized', external_reference: BUSINESS_ID } }
			],
			[
				'/authorized_payments/search',
				{
					body: {
						results: [{ id: 71, transaction_amount: 50000, payment: { id: 702, status: 'approved' } }]
					}
				}
			]
		]);

		const summary = await confirmMpSubscriptionForBusiness(admin, fetchMock, BUSINESS_ID);

		expect(summary.creditedNow).toBe(false);
		expect(summary.accessBlocked).toBe(true);
	});

	it('no se cae si MP no responde: devuelve lo que pudo confirmar', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [
					{ data: [{ preapproval_id: 'pre-x', status: 'pending' }], error: null }
				]
			}
		});
		const { fetchMock } = createFetchMock([['/preapproval/pre-x', { status: 500, body: {} }]]);

		const summary = await confirmMpSubscriptionForBusiness(admin, fetchMock, BUSINESS_ID);

		expect(summary).toEqual({ subscriptionStatus: null, creditedNow: false, accessBlocked: false });
		expect(rpcCalls).toHaveLength(0);
	});

	it('lanza si no se pueden leer las suscripciones locales (el load lo degrada)', async () => {
		const { admin } = createAdminMock({
			tables: {
				mp_subscriptions: [{ data: null, error: { message: 'db caída' } }]
			}
		});
		const { fetchMock } = createFetchMock([]);

		await expect(
			confirmMpSubscriptionForBusiness(admin, fetchMock, BUSINESS_ID)
		).rejects.toThrow('db caída');
	});
});

describe('pickRelevantMpSubscription', () => {
	it('prioriza autorizada > pausada > más reciente', () => {
		expect(
			pickRelevantMpSubscription([
				{ status: 'cancelled' },
				{ status: 'paused' },
				{ status: 'authorized' }
			])?.status
		).toBe('authorized');
		expect(
			pickRelevantMpSubscription([{ status: 'cancelled' }, { status: 'paused' }])?.status
		).toBe('paused');
		expect(pickRelevantMpSubscription([{ status: 'pending' }])?.status).toBe('pending');
		expect(pickRelevantMpSubscription([])).toBeNull();
	});
});

describe('reconcileMercadoPago', () => {
	it('cura un pago aprobado que el webhook no registró y lo deja auditado', async () => {
		const { admin, rpcCalls, insertCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [
					{ data: [{ business_id: BUSINESS_ID, preapproval_id: 'pre-1', status: 'authorized' }], error: null }
				]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-1',
				{ body: { id: 'pre-1', status: 'authorized', external_reference: BUSINESS_ID } }
			],
			[
				'/authorized_payments/search',
				{
					body: {
						results: [
							{ id: 90, transaction_amount: 50000, payment: { id: 888, status: 'approved' } },
							{ id: 91, transaction_amount: 50000, payment: { id: 889, status: 'rejected' } }
						]
					}
				}
			]
		]);

		const summary = await reconcileMercadoPago(admin, fetchMock);

		expect(summary).toMatchObject({ scanned: 1, credited: 1, attention: 0, errors: 0 });
		expect(rpcCalls).toHaveLength(1);
		expect(rpcCalls[0].args.p_idempotency_key).toBe('mp:payment:888');
		// Evento del pago curado + resumen de la corrida.
		const credited = insertCalls.find(
			(c) => (c.payload as { action?: string }).action === 'payment_credited'
		);
		expect(credited).toBeDefined();
		expect(credited!.payload).toMatchObject({
			topic: 'reconciliation',
			business_id: BUSINESS_ID,
			credited_grant_id: 'grant-1',
			requires_attention: false
		});
		const runSummary = insertCalls.find(
			(c) => (c.payload as { action?: string }).action === 'run_summary'
		);
		expect(runSummary).toBeDefined();
	});

	it('no loguea nada cuando todo ya estaba acreditado (corrida limpia)', async () => {
		const { admin, insertCalls } = createAdminMock({
			rpcQueue: [
				{ data: [{ applied: false, grant_id: 'grant-old', status_after: 'active' }], error: null }
			],
			tables: {
				mp_subscriptions: [
					{ data: [{ business_id: BUSINESS_ID, preapproval_id: 'pre-1', status: 'authorized' }], error: null }
				]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-1',
				{ body: { id: 'pre-1', status: 'authorized', external_reference: BUSINESS_ID } }
			],
			[
				'/authorized_payments/search',
				{
					body: {
						results: [{ id: 90, transaction_amount: 50000, payment: { id: 888, status: 'approved' } }]
					}
				}
			]
		]);

		const summary = await reconcileMercadoPago(admin, fetchMock);

		expect(summary).toMatchObject({ scanned: 1, credited: 0, attention: 0, errors: 0 });
		expect(insertCalls).toHaveLength(0);
	});

	it('avisa cuando una suscripción pasó a cancelled desde la última sincronización', async () => {
		const { admin, insertCalls, rpcCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [
					{ data: [{ business_id: BUSINESS_ID, preapproval_id: 'pre-2', status: 'authorized' }], error: null }
				]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-2',
				{ body: { id: 'pre-2', status: 'cancelled', external_reference: BUSINESS_ID } }
			],
			['/authorized_payments/search', { body: { results: [] } }]
		]);

		const summary = await reconcileMercadoPago(admin, fetchMock);

		expect(summary).toMatchObject({ scanned: 1, credited: 0, attention: 1, errors: 0 });
		expect(rpcCalls).toHaveLength(0);
		const changed = insertCalls.find(
			(c) => (c.payload as { action?: string }).action === 'subscription_status_changed'
		);
		expect(changed).toBeDefined();
		expect(changed!.payload).toMatchObject({ requires_attention: true, business_id: BUSINESS_ID });
	});

	it('acredita el cobro final de una suscripción recién cancelada (último barrido)', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [
					{ data: [{ business_id: BUSINESS_ID, preapproval_id: 'pre-f', status: 'authorized' }], error: null }
				]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-f',
				{ body: { id: 'pre-f', status: 'cancelled', external_reference: BUSINESS_ID } }
			],
			[
				'/authorized_payments/search',
				{
					body: {
						results: [{ id: 95, transaction_amount: 50000, payment: { id: 999, status: 'approved' } }]
					}
				}
			]
		]);

		const summary = await reconcileMercadoPago(admin, fetchMock);

		// El cobro perdido se acredita aunque la suscripción ya esté cancelada:
		// esta corrida es la última vez que la fila entra al filtro.
		expect(summary.credited).toBe(1);
		expect(summary.attention).toBeGreaterThanOrEqual(1);
		expect(rpcCalls[0].args.p_idempotency_key).toBe('mp:payment:999');
	});

	it('rota al fondo las filas cuya consulta a MP falla (no monopolizan la ventana)', async () => {
		const { admin, updateCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [
					{ data: [{ business_id: BUSINESS_ID, preapproval_id: 'pre-404', status: 'authorized' }], error: null }
				]
			}
		});
		const { fetchMock } = createFetchMock([['/preapproval/pre-404', { status: 404, body: {} }]]);

		const summary = await reconcileMercadoPago(admin, fetchMock);

		expect(summary.errors).toBe(1);
		const bump = updateCalls.find((c) => c.table === 'mp_subscriptions');
		expect(bump).toBeDefined();
		expect(bump!.payload).toHaveProperty('last_synced_at');
	});

	it('cuenta errores cuando la API de MP falla y sigue con el resto', async () => {
		const { admin, rpcCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [
					{
						data: [
							{ business_id: BUSINESS_ID, preapproval_id: 'pre-caida', status: 'authorized' },
							{ business_id: BUSINESS_ID, preapproval_id: 'pre-ok', status: 'authorized' }
						],
						error: null
					}
				]
			}
		});
		const { fetchMock } = createFetchMock([
			['/preapproval/pre-caida', { status: 500, body: {} }],
			[
				'/preapproval/pre-ok',
				{ body: { id: 'pre-ok', status: 'authorized', external_reference: BUSINESS_ID } }
			],
			[
				'/authorized_payments/search',
				{
					body: {
						results: [{ id: 92, transaction_amount: 50000, payment: { id: 890, status: 'approved' } }]
					}
				}
			]
		]);

		const summary = await reconcileMercadoPago(admin, fetchMock);

		expect(summary.errors).toBe(1);
		expect(summary.credited).toBe(1);
		expect(rpcCalls).toHaveLength(1);
	});

	it('respeta el presupuesto de tiempo', async () => {
		const { admin } = createAdminMock({
			tables: {
				mp_subscriptions: [
					{ data: [{ business_id: BUSINESS_ID, preapproval_id: 'pre-1', status: 'authorized' }], error: null }
				]
			}
		});
		const { fetchMock, calls } = createFetchMock([]);

		const summary = await reconcileMercadoPago(admin, fetchMock, { budgetMs: -1 });

		expect(summary.scanned).toBe(0);
		expect(calls).toHaveLength(0);
		expect(summary.details.join(' ')).toContain('Presupuesto');
	});
});

describe('logMpWebhookEvent', () => {
	it('inserta la fila en mp_webhook_events', async () => {
		const { admin, insertCalls } = createAdminMock();
		await logMpWebhookEvent(admin, {
			topic: 'payment',
			action: 'payment.updated',
			resource_id: '1',
			request_id: 'req-1',
			live_mode: true,
			signature_valid: true,
			processing_status: 'processed',
			processing_detail: 'ok'
		});
		expect(insertCalls).toHaveLength(1);
		expect(insertCalls[0].table).toBe('mp_webhook_events');
	});

	it('no lanza si el insert falla (el log nunca voltea el procesamiento)', async () => {
		const { admin } = createAdminMock({ insertError: { message: 'sin permisos' } });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(
			logMpWebhookEvent(admin, {
				topic: 'payment',
				action: null,
				resource_id: '1',
				request_id: null,
				live_mode: null,
				signature_valid: false,
				processing_status: 'rejected',
				processing_detail: 'firma inválida'
			})
		).resolves.toBeUndefined();
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});

describe('logMpWebhookEventOnce', () => {
	const row = {
		topic: 'reconciliation',
		action: 'payment_skipped',
		resource_id: '808',
		request_id: null,
		live_mode: null,
		signature_valid: true,
		processing_status: 'skipped' as const,
		processing_detail: 'negocio permanente',
		business_id: BUSINESS_ID,
		requires_attention: true
	};

	it('inserta y devuelve true la primera vez (sin evento previo)', async () => {
		const { admin, insertCalls } = createAdminMock();
		const alerted = await logMpWebhookEventOnce(admin, row);
		expect(alerted).toBe(true);
		expect(insertCalls).toHaveLength(1);
	});

	it('no inserta y devuelve false si ya existe un evento con misma action+resource_id', async () => {
		const { admin, insertCalls } = createAdminMock({
			tables: { mp_webhook_events: [{ data: { id: 'ya-existe' }, error: null }] }
		});
		const alerted = await logMpWebhookEventOnce(admin, row);
		expect(alerted).toBe(false);
		expect(insertCalls).toHaveLength(0);
	});
});

describe('reconcileMercadoPago: condiciones persistentes (idempotencia de alertas)', () => {
	it('un negocio permanente con preapproval vivo alerta UNA sola vez por pago', async () => {
		// Primera corrida: mp_webhook_events vacío → alerta. Segunda: ya existe →
		// no re-alerta (evita inundar el panel cada 6 h).
		const makeRun = (alreadyAlerted: boolean) =>
			createAdminMock({
				rpcQueue: [], // no llega a la RPC: el pre-check permanente corta antes
				tables: {
					mp_subscriptions: [
						{ data: [{ business_id: BUSINESS_ID, preapproval_id: 'pre-perm', status: 'authorized' }], error: null }
					],
					business_subscriptions: [{ data: { is_permanent: true }, error: null }],
					mp_webhook_events: alreadyAlerted
						? [{ data: { id: 'previo' }, error: null }]
						: [{ data: null, error: null }]
				}
			});
		const routes: Array<[string, { status?: number; body?: unknown }]> = [
			['/preapproval/pre-perm', { body: { id: 'pre-perm', status: 'authorized', external_reference: BUSINESS_ID } }],
			['/authorized_payments/search', { body: { results: [{ id: 1, transaction_amount: 50000, payment: { id: 500, status: 'approved' } }] } }]
		];

		const run1 = makeRun(false);
		const s1 = await reconcileMercadoPago(run1.admin, createFetchMock(routes).fetchMock);
		expect(s1.attention).toBe(1);
		const skipped1 = run1.insertCalls.filter(
			(c) => (c.payload as { action?: string }).action === 'payment_skipped'
		);
		expect(skipped1).toHaveLength(1);

		const run2 = makeRun(true);
		const s2 = await reconcileMercadoPago(run2.admin, createFetchMock(routes).fetchMock);
		expect(s2.attention).toBe(0);
		const skipped2 = run2.insertCalls.filter(
			(c) => (c.payload as { action?: string }).action === 'payment_skipped'
		);
		expect(skipped2).toHaveLength(0);
	});
});

describe('upsertMpSubscription: detección de doble suscripción autorizada', () => {
	it('alerta cuando hay más de una authorized para el mismo negocio', async () => {
		const { admin, insertCalls } = createAdminMock({
			tables: {
				// upsert (placeholder) + dup-check devuelve 2 filas authorized
				mp_subscriptions: [
					{ data: null, error: null },
					{ data: [{ preapproval_id: 'a' }, { preapproval_id: 'b' }], error: null }
				],
				mp_webhook_events: [{ data: null, error: null }]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-dup',
				{ body: { id: 'pre-dup', status: 'authorized', external_reference: BUSINESS_ID } }
			]
		]);

		await processMpWebhookEvent(admin, fetchMock, {
			topic: 'subscription_preapproval',
			resourceId: 'pre-dup'
		});

		const dup = insertCalls.find(
			(c) => (c.payload as { action?: string }).action === 'duplicate_authorized'
		);
		expect(dup).toBeDefined();
		expect(dup!.payload).toMatchObject({ requires_attention: true, business_id: BUSINESS_ID });
	});

	it('no alerta cuando hay una sola authorized', async () => {
		const { admin, insertCalls } = createAdminMock({
			tables: {
				mp_subscriptions: [
					{ data: null, error: null },
					{ data: [{ preapproval_id: 'a' }], error: null }
				]
			}
		});
		const { fetchMock } = createFetchMock([
			[
				'/preapproval/pre-solo',
				{ body: { id: 'pre-solo', status: 'authorized', external_reference: BUSINESS_ID } }
			]
		]);

		await processMpWebhookEvent(admin, fetchMock, {
			topic: 'subscription_preapproval',
			resourceId: 'pre-solo'
		});

		const dup = insertCalls.find(
			(c) => (c.payload as { action?: string }).action === 'duplicate_authorized'
		);
		expect(dup).toBeUndefined();
	});
});

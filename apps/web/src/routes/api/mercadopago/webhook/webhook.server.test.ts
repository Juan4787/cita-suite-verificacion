import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));

const { POST } = await import('./+server');

const SECRET = 'clave-secreta-de-prueba';
const BUSINESS_ID = '22222222-2222-4222-8222-222222222222';
const WEBHOOK_URL = 'https://app.test/api/mercadopago/webhook';

const createAdminMock = (opts?: {
	rpcResult?: { data?: unknown; error?: { message: string } | null };
}) => {
	const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
	const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
	const tableDefaults: Record<string, { data: unknown; error: null }> = {
		businesses: { data: { id: BUSINESS_ID }, error: null },
		business_subscriptions: { data: { is_permanent: false }, error: null },
		mp_subscriptions: { data: null, error: null }
	};
	const admin = {
		rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
			rpcCalls.push({ fn, args });
			return (
				opts?.rpcResult ?? {
					data: [{ applied: true, grant_id: 'grant-1', status_after: 'active' }],
					error: null
				}
			);
		}),
		from: vi.fn((table: string) => ({
			select: () => ({
				eq: () => ({
					maybeSingle: async () => tableDefaults[table] ?? { data: null, error: null }
				})
			}),
			upsert: async () => ({ error: null }),
			insert: async (payload: Record<string, unknown>) => {
				inserts.push({ table, payload });
				return { error: null };
			}
		}))
	};
	return { admin, inserts, rpcCalls };
};

// Request firmado como lo haría MP: data.id y type en la query, x-signature con
// ts fresco y x-request-id en headers.
const buildSignedRequest = (opts: {
	dataId: string;
	topic: string;
	valid?: boolean;
	omitSignature?: boolean;
	body?: Record<string, unknown>;
}) => {
	const ts = String(Math.floor(Date.now() / 1000));
	const requestId = 'req-test-1';
	const manifest = `id:${opts.dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
	const v1 =
		opts.valid === false
			? '0'.repeat(64)
			: crypto.createHmac('sha256', SECRET).update(manifest, 'utf8').digest('hex');
	const url = new URL(`${WEBHOOK_URL}?data.id=${opts.dataId}&type=${opts.topic}`);
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'x-request-id': requestId
	};
	if (!opts.omitSignature) {
		headers['x-signature'] = `ts=${ts},v1=${v1}`;
	}
	const request = new Request(url, {
		method: 'POST',
		headers,
		body: JSON.stringify(opts.body ?? { action: 'payment.updated', live_mode: true })
	});
	return { request, url };
};

const callPost = (request: Request, url: URL, fetchMock: typeof fetch) =>
	POST({ request, url, fetch: fetchMock } as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	envState.privateEnv.MP_ACCESS_TOKEN = 'token-de-prueba';
	envState.privateEnv.MP_WEBHOOK_SECRET = SECRET;
});

describe('POST /api/mercadopago/webhook', () => {
	it('corta el spam sin header de firma con 401, sin tocar Supabase ni la API de MP', async () => {
		const { admin, inserts } = createAdminMock();
		mocks.createSupabaseAdminClient.mockResolvedValue(admin);
		const mpFetch = vi.fn();
		const { request, url } = buildSignedRequest({
			dataId: '111',
			topic: 'payment',
			omitSignature: true
		});

		const response = await callPost(request, url, mpFetch as unknown as typeof fetch);

		expect(response.status).toBe(401);
		expect(mpFetch).not.toHaveBeenCalled();
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
		expect(inserts).toHaveLength(0);
	});

	it('rechaza con 401 SIN tocar Supabase aunque la firma tenga forma de MP (anti-flood)', async () => {
		// Un anónimo puede mandar un x-signature con formato válido pero HMAC
		// falso; el rechazo no debe generar ningún INSERT ni crear cliente admin
		// (si no, sería un write privilegiado gratis por request).
		const { admin, inserts, rpcCalls } = createAdminMock();
		mocks.createSupabaseAdminClient.mockResolvedValue(admin);
		const mpFetch = vi.fn();
		const { request, url } = buildSignedRequest({ dataId: '111', topic: 'payment', valid: false });

		const response = await callPost(request, url, mpFetch as unknown as typeof fetch);

		expect(response.status).toBe(401);
		expect(mpFetch).not.toHaveBeenCalled();
		expect(rpcCalls).toHaveLength(0);
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
		expect(inserts).toHaveLength(0);
	});

	it('acredita un pago aprobado con firma válida y registra el evento como processed', async () => {
		const { admin, inserts, rpcCalls } = createAdminMock();
		mocks.createSupabaseAdminClient.mockResolvedValue(admin);
		const mpFetch = vi.fn(
			async (_input: RequestInfo | URL) =>
				new Response(
					JSON.stringify({
						id: 111,
						status: 'approved',
						external_reference: BUSINESS_ID,
						transaction_amount: 50000
					}),
					{ status: 200 }
				)
		);
		const { request, url } = buildSignedRequest({ dataId: '111', topic: 'payment' });

		const response = await callPost(request, url, mpFetch as unknown as typeof fetch);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(mpFetch).toHaveBeenCalledTimes(1);
		expect(String(mpFetch.mock.calls[0][0])).toContain('/v1/payments/111');
		expect(rpcCalls).toHaveLength(1);
		expect(rpcCalls[0].args).toMatchObject({
			p_operation: 'payment_registered',
			p_source: 'mercado_pago',
			p_admin_id: null,
			p_idempotency_key: 'mp:payment:111'
		});
		expect(inserts).toHaveLength(1);
		expect(inserts[0].payload).toMatchObject({
			processing_status: 'processed',
			signature_valid: true,
			business_id: BUSINESS_ID,
			credited_grant_id: 'grant-1',
			requires_attention: false,
			raw: { action: 'payment.updated', live_mode: true }
		});
	});

	it('responde 500 (para que MP reintente) y registra el evento cuando la acreditación falla', async () => {
		const { admin, inserts } = createAdminMock({
			rpcResult: { data: null, error: { message: 'db caída' } }
		});
		mocks.createSupabaseAdminClient.mockResolvedValue(admin);
		const mpFetch = vi.fn(
			async (_input: RequestInfo | URL) =>
				new Response(
					JSON.stringify({ id: 112, status: 'approved', external_reference: BUSINESS_ID }),
					{ status: 200 }
				)
		);
		const { request, url } = buildSignedRequest({ dataId: '112', topic: 'payment' });

		const response = await callPost(request, url, mpFetch as unknown as typeof fetch);

		expect(response.status).toBe(500);
		expect(inserts).toHaveLength(1);
		expect(inserts[0].payload).toMatchObject({
			processing_status: 'error',
			requires_attention: true
		});
	});
});

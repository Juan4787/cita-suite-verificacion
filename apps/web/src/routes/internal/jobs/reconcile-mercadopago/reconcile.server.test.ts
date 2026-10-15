import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	reconcileMercadoPago: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock('$lib/server/mercadopago', () => ({
	reconcileMercadoPago: mocks.reconcileMercadoPago
}));

const { POST } = await import('./+server');

const JOB_URL = 'https://app.test/internal/jobs/reconcile-mercadopago';

const callPost = (headers: Record<string, string>, url = JOB_URL) =>
	POST({
		request: new Request(url, { method: 'POST', headers }),
		fetch: vi.fn(),
		url: new URL(url)
	} as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
});

describe('POST /internal/jobs/reconcile-mercadopago', () => {
	it('falla-cerrado sin INTERNAL_JOB_SECRET configurado', async () => {
		const response = await callPost({ authorization: 'Bearer lo-que-sea' });
		expect(response.status).toBe(503);
		expect(mocks.reconcileMercadoPago).not.toHaveBeenCalled();
	});

	it('rechaza secrets incorrectos', async () => {
		envState.privateEnv.INTERNAL_JOB_SECRET = 'secreto-real';
		const response = await callPost({ authorization: 'Bearer equivocado' });
		expect(response.status).toBe(401);
		expect(mocks.reconcileMercadoPago).not.toHaveBeenCalled();
	});

	it('con el secret correcto corre la conciliación y devuelve el resumen', async () => {
		envState.privateEnv.INTERNAL_JOB_SECRET = 'secreto-real';
		mocks.createSupabaseAdminClient.mockResolvedValue({ admin: true });
		mocks.reconcileMercadoPago.mockResolvedValue({
			scanned: 2,
			credited: 1,
			attention: 0,
			errors: 0,
			details: []
		});

		const response = await callPost(
			{ authorization: 'Bearer secreto-real' },
			`${JOB_URL}?limit=5`
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ scanned: 2, credited: 1 });
		expect(mocks.reconcileMercadoPago).toHaveBeenCalledWith(
			{ admin: true },
			expect.any(Function),
			{ limit: 5 }
		);
	});
});

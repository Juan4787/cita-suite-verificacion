import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	legacyJobEntrypointsEnabled: vi.fn(),
	runScheduledJob: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/integrations/public/scheduled-jobs', () => ({
	legacyJobEntrypointsEnabled: mocks.legacyJobEntrypointsEnabled,
	runScheduledJob: mocks.runScheduledJob
}));

const { POST } = await import('./+server');

const JOB_URL = 'https://app.test/internal/jobs/reconcile-mercadopago';
const requestFetch = vi.fn();

const callPost = (headers: Record<string, string>) =>
	POST({
		request: new Request(JOB_URL, { method: 'POST', headers }),
		fetch: requestFetch,
		url: new URL(JOB_URL)
	} as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	mocks.legacyJobEntrypointsEnabled.mockResolvedValue(true);
	mocks.runScheduledJob.mockResolvedValue({ ok: true, kind: 'commercial', scheduledFor: null, budget: {}, result: { scanned: 2, credited: 1 } });
});

describe('POST /internal/jobs/reconcile-mercadopago (entrada anterior)', () => {
	it('falla-cerrado sin INTERNAL_JOB_SECRET configurado', async () => {
		const response = await callPost({ authorization: 'Bearer lo-que-sea' });
		expect(response.status).toBe(503);
		expect(mocks.runScheduledJob).not.toHaveBeenCalled();
	});

	it('rechaza secrets incorrectos', async () => {
		envState.privateEnv.INTERNAL_JOB_SECRET = 'secreto-real';
		const response = await callPost({ authorization: 'Bearer equivocado' });
		expect(response.status).toBe(401);
		expect(mocks.legacyJobEntrypointsEnabled).not.toHaveBeenCalled();
		expect(mocks.runScheduledJob).not.toHaveBeenCalled();
	});

	it('con el secret correcto corre la conciliación presupuestada y devuelve su recibo', async () => {
		envState.privateEnv.INTERNAL_JOB_SECRET = 'secreto-real';
		const response = await callPost({ authorization: 'Bearer secreto-real' });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ ok: true, kind: 'commercial', result: { scanned: 2, credited: 1 } });
		expect(mocks.runScheduledJob).toHaveBeenCalledWith('commercial', requestFetch);
	});

	it('responde 410 sin conciliar cuando el release apagó las entradas antiguas', async () => {
		envState.privateEnv.INTERNAL_JOB_SECRET = 'secreto-real';
		mocks.legacyJobEntrypointsEnabled.mockResolvedValue(false);
		const response = await callPost({ authorization: 'Bearer secreto-real' });
		expect(response.status).toBe(410);
		expect(mocks.runScheduledJob).not.toHaveBeenCalled();
	});
});

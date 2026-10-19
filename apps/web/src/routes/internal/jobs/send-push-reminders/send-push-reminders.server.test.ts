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
const JOB_URL = 'https://app.test/internal/jobs/send-push-reminders';
const requestFetch = vi.fn();

const callPost = (secret = 'job-secret') =>
	POST({
		request: new Request(JOB_URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${secret}` }
		}),
		fetch: requestFetch,
		url: new URL(JOB_URL)
	} as unknown as Parameters<typeof POST>[0]);

const receipt = (ok: boolean) => ({ ok, kind: 'push', scheduledFor: null, budget: { usedCalls: 3 }, result: ok ? { sent: 1 } : null });

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	envState.privateEnv.INTERNAL_JOB_SECRET = 'job-secret';
	mocks.legacyJobEntrypointsEnabled.mockResolvedValue(true);
	mocks.runScheduledJob.mockResolvedValue(receipt(true));
});

describe('POST /internal/jobs/send-push-reminders (entrada anterior)', () => {
	it('rechaza un job sin el secreto correcto antes de consultar o tocar las colas', async () => {
		const response = await callPost('incorrecto');
		expect(response.status).toBe(401);
		expect(mocks.legacyJobEntrypointsEnabled).not.toHaveBeenCalled();
		expect(mocks.runScheduledJob).not.toHaveBeenCalled();
	});

	it('durante la transición ejecuta sólo push, con la implementación del programador nuevo', async () => {
		const response = await callPost();
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ ok: true, kind: 'push' });
		expect(mocks.runScheduledJob).toHaveBeenCalledOnce();
		expect(mocks.runScheduledJob).toHaveBeenCalledWith('push', requestFetch);
	});

	it('informa 500 cuando la tarea no terminó', async () => {
		mocks.runScheduledJob.mockResolvedValue(receipt(false));
		const response = await callPost();
		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toMatchObject({ ok: false, kind: 'push' });
	});

	it('responde 410 sin ejecutar nada cuando el release apagó las entradas antiguas', async () => {
		mocks.legacyJobEntrypointsEnabled.mockResolvedValue(false);
		const response = await callPost();
		expect(response.status).toBe(410);
		expect(mocks.runScheduledJob).not.toHaveBeenCalled();
	});

	it('no ejecuta la tarea si no pudo consultar el interruptor', async () => {
		mocks.legacyJobEntrypointsEnabled.mockRejectedValue(new Error('PRIVATE_SENTINEL'));
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const response = await callPost();
			expect(response.status).toBe(503);
			expect(mocks.runScheduledJob).not.toHaveBeenCalled();
			expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_SENTINEL');
		} finally {
			log.mockRestore();
		}
	});
});

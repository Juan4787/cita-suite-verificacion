import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));
const mocks = vi.hoisted(() => ({ runScheduledJob: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/integrations/public/scheduled-jobs', () => ({ runScheduledJob: mocks.runScheduledJob }));

const { POST } = await import('./+server');
const { match } = await import('../../../../params/job');
const requestFetch = vi.fn();

const callPost = (kind: string, headers: Record<string, string>) => {
	const url = `https://scheduler.cita-suite.internal/internal/jobs/${kind}`;
	return POST({
		request: new Request(url, { method: 'POST', headers }),
		params: { kind },
		fetch: requestFetch,
		url: new URL(url)
	} as unknown as Parameters<typeof POST>[0]);
};

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	envState.privateEnv.INTERNAL_JOB_SECRET = 'job-secret';
});

describe('POST /internal/jobs/[kind]', () => {
	it('sólo admite las categorías que el programador puede nombrar', () => {
		for (const kind of ['push', 'calendar', 'reviews', 'uploads', 'commercial', 'storage']) expect(match(kind)).toBe(true);
		for (const kind of ['maintenance', 'send-push-reminders', 'reconcile-mercadopago', 'PUSH', '']) expect(match(kind)).toBe(false);
	});

	it('exige el secreto de tareas internas antes de ejecutar', async () => {
		const response = await callPost('push', { authorization: 'Bearer otro' });
		expect(response.status).toBe(401);
		expect(mocks.runScheduledJob).not.toHaveBeenCalled();
	});

	it('ejecuta la categoría pedida con la hora programada y devuelve el recibo', async () => {
		mocks.runScheduledJob.mockResolvedValue({ ok: true, kind: 'calendar', scheduledFor: '2026-10-19T12:06:00.000Z', budget: {}, result: {} });
		const response = await callPost('calendar', {
			authorization: 'Bearer job-secret',
			'x-cita-scheduled-time': '2026-10-19T12:06:00.000Z'
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ ok: true, kind: 'calendar' });
		expect(mocks.runScheduledJob).toHaveBeenCalledWith('calendar', requestFetch, { scheduledTime: '2026-10-19T12:06:00.000Z' });
	});

	it('informa 500 para que el programador registre la ejecución fallida', async () => {
		mocks.runScheduledJob.mockResolvedValue({ ok: false, kind: 'uploads', scheduledFor: null, budget: {}, result: null });
		const response = await callPost('uploads', { authorization: 'Bearer job-secret' });
		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toMatchObject({ ok: false, kind: 'uploads' });
	});
});

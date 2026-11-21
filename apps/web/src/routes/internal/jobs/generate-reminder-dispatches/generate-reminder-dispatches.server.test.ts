import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	legacyJobEntrypointsEnabled: vi.fn(),
	generateReminderDispatches: vi.fn(),
	createSupabaseAdminClient: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/integrations/public/scheduled-jobs', () => ({
	legacyJobEntrypointsEnabled: mocks.legacyJobEntrypointsEnabled
}));
vi.mock('$lib/server/integrations/public/messaging', () => ({
	generateReminderDispatches: mocks.generateReminderDispatches
}));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));

const { POST } = await import('./+server');

const JOB_URL = 'https://app.test/internal/jobs/generate-reminder-dispatches';
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
	mocks.legacyJobEntrypointsEnabled.mockResolvedValue(false);
	mocks.createSupabaseAdminClient.mockResolvedValue({});
	mocks.generateReminderDispatches.mockResolvedValue({ generated: 0 });
});

describe('AF1-013: POST /internal/jobs/generate-reminder-dispatches', () => {
	it('responde 410 sin ejecutar trabajo cuando las entradas antiguas están apagadas', async () => {
		envState.privateEnv.INTERNAL_JOB_SECRET = 'secreto-real';
		const response = await callPost({ authorization: 'Bearer secreto-real' });
		expect(response.status).toBe(410);
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
		expect(mocks.generateReminderDispatches).not.toHaveBeenCalled();
	});

	it('falla-cerrado con 503 si no puede verificar el estado de las entradas antiguas', async () => {
		envState.privateEnv.INTERNAL_JOB_SECRET = 'secreto-real';
		mocks.legacyJobEntrypointsEnabled.mockRejectedValue(new Error('PRIVATE_SENTINEL'));
		const response = await callPost({ authorization: 'Bearer secreto-real' });
		expect(response.status).toBe(503);
		expect(mocks.generateReminderDispatches).not.toHaveBeenCalled();
	});
});

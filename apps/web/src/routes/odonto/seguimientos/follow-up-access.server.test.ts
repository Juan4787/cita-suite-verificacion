import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	getOdontoContext: vi.fn(),
	createSupabaseAdminClient: vi.fn(),
	roleParticipatesInFollowUps: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/odonto-context', () => ({
	getOdontoContext: mocks.getOdontoContext
}));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock('$lib/server/follow-ups', () => ({
	buildFollowUpScope: vi.fn(),
	businessTodayISO: vi.fn(() => '2026-07-07'),
	createFollowUp: vi.fn(),
	FollowUpError: class FollowUpError extends Error {
		code: string;
		constructor(code: string) {
			super(code);
			this.code = code;
		}
	},
	getFollowUpErrorMessage: vi.fn(() => 'Error de seguimiento'),
	getFollowUpErrorStatus: vi.fn(() => 400),
	markFollowUpDone: vi.fn(),
	roleParticipatesInFollowUps: mocks.roleParticipatesInFollowUps,
	snoozeFollowUp: vi.fn(),
	snoozePresetDate: vi.fn(() => '2026-07-08'),
	updateFollowUp: vi.fn()
}));

const { POST: createFollowUpPost } = await import('./crear/+server');
const { POST: editFollowUpPost } = await import('./[id]/editar/+server');
const { POST: snoozeFollowUpPost } = await import('./[id]/posponer/+server');
const { POST: manageFollowUpPost } = await import('./[id]/gestionar/+server');

const restrictedBusiness = {
	role: 'owner',
	access: {
		canUseBusiness: false
	}
};

const event = (body: Record<string, unknown> = {}) => ({
	params: { id: 'follow-up-1' },
	request: new Request('http://localhost/odonto/seguimientos', {
		method: 'POST',
		body: JSON.stringify(body)
	}),
	locals: { auth: { access_token: 'token', refresh_token: 'refresh' } },
	fetch: vi.fn(),
	cookies: {}
});

const expectRestricted = async (response: Response) => {
	expect(response.status).toBe(403);
	await expect(response.json()).resolves.toMatchObject({
		message: expect.stringContaining('Activá tu suscripción')
	});
	expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
};

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	mocks.roleParticipatesInFollowUps.mockReturnValue(true);
	mocks.getOdontoContext.mockResolvedValue({
		business: restrictedBusiness,
		userId: 'user-1',
		supabase: {}
	});
});

describe('seguimientos bloquea operaciones con acceso comercial vencido', () => {
	it('bloquea crear seguimiento', async () => {
		const response = (await createFollowUpPost(event({ patient_id: 'p1' }) as never)) as Response;
		await expectRestricted(response);
	});

	it('bloquea editar seguimiento', async () => {
		const response = (await editFollowUpPost(event({ remind_on: '2026-07-08' }) as never)) as Response;
		await expectRestricted(response);
	});

	it('bloquea posponer seguimiento', async () => {
		const response = (await snoozeFollowUpPost(event({ preset: 'manana' }) as never)) as Response;
		await expectRestricted(response);
	});

	it('bloquea marcar seguimiento como gestionado', async () => {
		const response = (await manageFollowUpPost(event() as never)) as Response;
		await expectRestricted(response);
	});
});

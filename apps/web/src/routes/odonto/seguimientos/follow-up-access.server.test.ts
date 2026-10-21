import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	getOdontoContext: vi.fn(),
	createSupabaseAdminClient: vi.fn(),
	roleParticipatesInFollowUps: vi.fn(),
	createFollowUp: vi.fn(),
	updateFollowUp: vi.fn(),
	snoozeFollowUp: vi.fn(),
	markFollowUpDone: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/access/public/odonto-context', () => ({
	getOdontoContext: mocks.getOdontoContext
}));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock('$lib/server/patients/public/follow-ups', () => ({
	buildFollowUpScope: vi.fn(async () => ({
		businessId: 'business-1', role: 'owner', professionalId: null, timezone: 'America/Argentina/Buenos_Aires'
	})),
	businessTodayISO: vi.fn(() => '2026-07-07'),
	createFollowUp: mocks.createFollowUp,
	FollowUpError: class FollowUpError extends Error {
		code: string;
		constructor(code: string) {
			super(code);
			this.code = code;
		}
	},
	getFollowUpErrorMessage: vi.fn(() => 'Error de seguimiento'),
	getFollowUpErrorStatus: vi.fn(() => 400),
	markFollowUpDone: mocks.markFollowUpDone,
	roleParticipatesInFollowUps: mocks.roleParticipatesInFollowUps,
	snoozeFollowUp: mocks.snoozeFollowUp,
	snoozePresetDate: vi.fn(() => '2026-07-08'),
	updateFollowUp: mocks.updateFollowUp
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

const event = (body: unknown = {}) => ({
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

describe('seguimientos valida la estructura JSON antes de operar', () => {
	it.each([null, [], true, 'texto'])(
		'rechaza cuerpos que no son objetos: %j',
		async (body) => {
			mocks.getOdontoContext.mockResolvedValue({
				business: { ...restrictedBusiness, access: { canUseBusiness: true } },
				userId: 'user-1', supabase: {}
			});
			for (const handler of [createFollowUpPost, editFollowUpPost, snoozeFollowUpPost, manageFollowUpPost]) {
				const response = await handler(event(body) as never);
				expect(response.status).toBe(400);
				await expect(response.json()).resolves.toEqual({ message: 'Solicitud inválida.' });
			}
		}
	);
});

// The database owns the follow-up rules: every change goes through the user's own
// client and its functions, never the service role.
describe('seguimientos opera con las reglas del propio usuario', () => {
	const userClient = { from: vi.fn(), rpc: vi.fn() };
	beforeEach(() => {
		mocks.getOdontoContext.mockResolvedValue({
			business: {
				role: 'owner',
				business: { id: 'business-1', timezone: 'America/Argentina/Buenos_Aires' },
				access: { canUseBusiness: true }
			},
			userId: 'user-1',
			supabase: userClient
		});
	});

	it.each([
		['crear', () => createFollowUpPost(event({ patient_id: 'patient-1', remind_on: '2026-07-08', assigned_professional_id: 'professional-1' }) as never), mocks.createFollowUp],
		['editar', () => editFollowUpPost(event({ remind_on: '2026-07-08', expected_updated_at: '2026-07-07T12:00:00.000Z' }) as never), mocks.updateFollowUp],
		['posponer', () => snoozeFollowUpPost(event({ preset: 'manana', expected_updated_at: '2026-07-07T12:00:00.000Z' }) as never), mocks.snoozeFollowUp],
		['gestionar', () => manageFollowUpPost(event({ expected_updated_at: '2026-07-07T12:00:00.000Z' }) as never), mocks.markFollowUpDone]
	])('%s cambia el seguimiento con el cliente del usuario', async (_name, call, change) => {
		change.mockResolvedValue('follow-up-1');
		const response = await call();
		expect(response.status).toBe(200);
		expect(change).toHaveBeenCalledWith(userClient, expect.anything());
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
	});
});

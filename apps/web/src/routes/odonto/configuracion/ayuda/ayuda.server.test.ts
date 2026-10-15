import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn(),
	createSupabaseAdminClient: vi.fn(),
	getEmailFromAccessToken: vi.fn(),
	isMasterEmail: vi.fn(),
	resolveActiveBusiness: vi.fn(),
	demoBusinessContext: vi.fn(),
	activateAccountAssistance: vi.fn(),
	revokeAccountAssistance: vi.fn(),
	dismissAccountAssistanceNotice: vi.fn(),
	loadAccountAssistanceView: vi.fn(),
	buildAccountAssistanceView: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	getEmailFromAccessToken: mocks.getEmailFromAccessToken,
	isMasterEmail: mocks.isMasterEmail
}));
vi.mock('$lib/server/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness,
	demoBusinessContext: mocks.demoBusinessContext
}));
vi.mock('$lib/server/account-assistance', () => ({
	activateAccountAssistance: mocks.activateAccountAssistance,
	revokeAccountAssistance: mocks.revokeAccountAssistance,
	dismissAccountAssistanceNotice: mocks.dismissAccountAssistanceNotice,
	loadAccountAssistanceView: mocks.loadAccountAssistanceView,
	buildAccountAssistanceView: mocks.buildAccountAssistanceView,
	accountAssistanceErrorMessage: (error: unknown) =>
		error instanceof Error ? error.message : 'No pudimos actualizar la ayuda para configurar.',
	safeAssistanceReturnTo: (value: FormDataEntryValue | null) =>
		String(value ?? '').startsWith('/odonto') ? String(value) : '/odonto/configuracion/ayuda'
}));

const { load, actions } = await import('./+page.server');

const BUSINESS_ID = '55555555-5555-4555-8555-555555555555';

const context = (role: 'owner' | 'admin' | 'reception' = 'owner', overrides: Record<string, unknown> = {}) => ({
	business: {
		id: BUSINESS_ID,
		name: 'Consultorio',
		timezone: 'America/Argentina/Buenos_Aires'
	},
	role,
	canManage: role === 'owner' || role === 'admin',
	canOperate: role !== 'reception',
	access: { canUseBusiness: true },
	...overrides
});

const makeEvent = (formEntries: Record<string, string> = {}) => ({
	locals: { auth: { access_token: 'token', refresh_token: 'refresh' } },
	fetch,
	cookies: {},
	request: new Request('https://app.test/odonto/configuracion/ayuda', {
		method: 'POST',
		body: new URLSearchParams(formEntries)
	})
});

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	mocks.createSupabaseServerClient.mockResolvedValue({ from: vi.fn(), rpc: vi.fn() });
	mocks.createSupabaseAdminClient.mockResolvedValue({ from: vi.fn(), auth: { admin: { listUsers: vi.fn() } } });
	mocks.getEmailFromAccessToken.mockReturnValue('owner@test.com');
	mocks.isMasterEmail.mockReturnValue(false);
	mocks.loadAccountAssistanceView.mockResolvedValue({
		status: 'available',
		showBanner: true,
		canActivate: true
	});
});

describe('configuracion ayuda server', () => {
	it('loads for owner and reads the current help state', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));

		const result = (await load(makeEvent() as never)) as { assistance: unknown; demo: boolean };

		expect(result.demo).toBe(false);
		expect(mocks.loadAccountAssistanceView).toHaveBeenCalledWith(
			expect.objectContaining({
				businessId: BUSINESS_ID,
				role: 'owner',
				timeZone: 'America/Argentina/Buenos_Aires',
				canUseBusiness: true
			})
		);
	});

	it('activates only for the owner and redirects back', async () => {
		const supabase = { rpc: vi.fn() };
		const admin = { from: vi.fn(), auth: { admin: { listUsers: vi.fn() } } };
		mocks.createSupabaseServerClient.mockResolvedValue(supabase);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin);
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		mocks.activateAccountAssistance.mockResolvedValue({ id: 'assist-1' });

		await expect(
			actions.activate(
				makeEvent({ return_to: '/odonto/agenda' }) as never
			)
		).rejects.toMatchObject({ status: 303, location: '/odonto/agenda' });

		expect(mocks.activateAccountAssistance).toHaveBeenCalledWith({
			supabase,
			admin,
			businessId: BUSINESS_ID
		});
	});

	it('rejects activation from admins', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('admin'));

		const result = (await actions.activate(makeEvent({ return_to: '/odonto/agenda' }) as never)) as {
			status: number;
		};

		expect(result.status).toBe(403);
		expect(mocks.activateAccountAssistance).not.toHaveBeenCalled();
	});

	it('redirects the master away from the request-help page outside an assistance session', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		mocks.isMasterEmail.mockReturnValue(true);

		await expect(load(makeEvent() as never)).rejects.toMatchObject({
			status: 303,
			location: '/odonto/maestro'
		});
	});

	it('blocks a direct master request to activate help', async () => {
		mocks.isMasterEmail.mockReturnValue(true);

		const result = (await actions.activate(makeEvent() as never)) as {
			status: number;
			data: { message: string };
		};

		expect(result.status).toBe(403);
		expect(result.data.message).toContain('cuenta maestra no solicita ayuda');
		expect(mocks.resolveActiveBusiness).not.toHaveBeenCalled();
	});

	it('revokes only for the owner', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		mocks.revokeAccountAssistance.mockResolvedValue({ id: 'assist-1' });

		await expect(
			actions.revoke(makeEvent({ return_to: '/odonto/configuracion/ayuda' }) as never)
		).rejects.toMatchObject({ status: 303, location: '/odonto/configuracion/ayuda' });

		expect(mocks.revokeAccountAssistance).toHaveBeenCalledWith(
			expect.objectContaining({ businessId: BUSINESS_ID })
		);
	});

	it('dismisses a finished notice only for the owner', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));

		await expect(
			actions.dismiss(
				makeEvent({ return_to: '/odonto/agenda', grant_id: 'assist-1' }) as never
			)
		).rejects.toMatchObject({ status: 303, location: '/odonto/agenda' });

		expect(mocks.dismissAccountAssistanceNotice).toHaveBeenCalledWith({
			supabase: expect.anything(),
			businessId: BUSINESS_ID,
			grantId: 'assist-1'
		});
	});
});

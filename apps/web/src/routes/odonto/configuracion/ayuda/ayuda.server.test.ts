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
	extendAccountAssistance: vi.fn(),
	endAccountAssistance: vi.fn(),
	dismissAccountAssistanceNotice: vi.fn(),
	loadAccountAssistanceView: vi.fn(),
	loadAccountAssistanceHasPatients: vi.fn(),
	buildAccountAssistanceView: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	getEmailFromAccessToken: mocks.getEmailFromAccessToken,
	isMasterEmail: mocks.isMasterEmail
}));
vi.mock('$lib/server/access/public/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness,
	demoBusinessContext: mocks.demoBusinessContext
}));
vi.mock('$lib/server/access/public/account-assistance', () => ({
	activateAccountAssistance: mocks.activateAccountAssistance,
	extendAccountAssistance: mocks.extendAccountAssistance,
	endAccountAssistance: mocks.endAccountAssistance,
	dismissAccountAssistanceNotice: mocks.dismissAccountAssistanceNotice,
	loadAccountAssistanceView: mocks.loadAccountAssistanceView,
	loadAccountAssistanceHasPatients: mocks.loadAccountAssistanceHasPatients,
	buildAccountAssistanceView: mocks.buildAccountAssistanceView,
	accountAssistanceErrorMessage: (error: unknown) =>
		error instanceof Error ? error.message : 'No pudimos actualizar la ayuda para configurar.',
	accountAssistanceErrorStatus: () => 500,
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
	mocks.loadAccountAssistanceHasPatients.mockResolvedValue(false);
});

// What the confirmation dialog sends: the action only runs after the person confirms it.
const confirmed = (entries: Record<string, string> = {}) => ({ confirmed: '1', ...entries });
const masterAssisting = () => {
	mocks.isMasterEmail.mockReturnValue(true);
	mocks.resolveActiveBusiness.mockResolvedValue(
		context('admin', { assistance: { grantId: 'assist-1', supportUserId: 'master-1' } })
	);
};

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

	it('gives the duration the owner chose, after the confirmation, and redirects back', async () => {
		const supabase = { rpc: vi.fn() };
		const admin = { from: vi.fn(), auth: { admin: { listUsers: vi.fn() } } };
		mocks.createSupabaseServerClient.mockResolvedValue(supabase);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin);
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		mocks.activateAccountAssistance.mockResolvedValue({ id: 'assist-1' });

		await expect(
			actions.activate(makeEvent(confirmed({ return_to: '/odonto/agenda', kind: 'day' })) as never)
		).rejects.toMatchObject({ status: 303, location: '/odonto/agenda' });

		expect(mocks.activateAccountAssistance).toHaveBeenCalledWith({
			supabase,
			admin,
			businessId: BUSINESS_ID,
			kind: 'day'
		});
	});

	it('gives nothing without the confirmation or without one of the three durations', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));

		for (const entries of [{ kind: 'day' }, confirmed({ kind: 'week' }), confirmed({})]) {
			const result = (await actions.activate(makeEvent(entries) as never)) as { status: number };
			expect(result.status).toBe(400);
		}
		expect(mocks.activateAccountAssistance).not.toHaveBeenCalled();
	});

	it('rejects activation from admins', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('admin'));

		const result = (await actions.activate(makeEvent(confirmed({ return_to: '/odonto/agenda', kind: 'hour' })) as never)) as {
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

	it('recognizes the master by the identity Auth verified, not by the claim the token carries', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		mocks.getEmailFromAccessToken.mockReturnValue('master@test.com');
		mocks.isMasterEmail.mockImplementation((email?: string | null) => email === 'master@test.com');
		const event = { ...makeEvent(), locals: { ...makeEvent().locals, verifiedUser: { email: 'owner@test.com' } } };

		await expect(load(event as never)).resolves.toMatchObject({ demo: false });
	});

	it('says it could not read the help state instead of showing it as available', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		mocks.loadAccountAssistanceView.mockRejectedValue(new Error('read failed'));

		await expect(load(makeEvent() as never)).rejects.toMatchObject({ status: 503 });
	});

	it('reads the patients for the owner and passes them to the options', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		mocks.loadAccountAssistanceHasPatients.mockResolvedValue(true);

		const result = (await load(makeEvent() as never)) as { serverNow: string };

		expect(mocks.loadAccountAssistanceHasPatients).toHaveBeenCalledWith(
			expect.objectContaining({ businessId: BUSINESS_ID })
		);
		expect(mocks.loadAccountAssistanceView).toHaveBeenCalledWith(expect.objectContaining({ hasPatients: true }));
		expect(Number.isFinite(Date.parse(result.serverNow))).toBe(true);
	});

	it('does not list durations when it could not read the patients', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		mocks.loadAccountAssistanceHasPatients.mockRejectedValue(new Error('read failed'));

		await expect(load(makeEvent() as never)).rejects.toMatchObject({ status: 503 });
		expect(mocks.loadAccountAssistanceView).not.toHaveBeenCalled();
	});

	it('does not ask the patients of anyone but the owner', async () => {
		masterAssisting();

		await load(makeEvent() as never);

		expect(mocks.loadAccountAssistanceHasPatients).not.toHaveBeenCalled();
		expect(mocks.loadAccountAssistanceView).toHaveBeenCalledWith(
			expect.objectContaining({ hasPatients: undefined, isAssisting: true })
		);
	});

	it('blocks a direct master request to give or extend help', async () => {
		mocks.isMasterEmail.mockReturnValue(true);

		for (const action of [actions.activate, actions.extend]) {
			const result = (await action(makeEvent(confirmed({ kind: 'day', grant_id: 'assist-1' })) as never)) as {
				status: number;
				data: { message: string };
			};
			expect(result.status).toBe(403);
			expect(result.data.message).toContain('cuenta maestra no da ni extiende la ayuda');
		}
		expect(mocks.resolveActiveBusiness).not.toHaveBeenCalled();
	});

	it('extends exactly the grant shown, to the duration chosen, after the confirmation', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));

		await expect(
			actions.extend(makeEvent(confirmed({ return_to: '/odonto/configuracion/ayuda', grant_id: 'assist-1', kind: 'initial_setup' })) as never)
		).rejects.toMatchObject({ status: 303, location: '/odonto/configuracion/ayuda' });

		expect(mocks.extendAccountAssistance).toHaveBeenCalledWith({
			supabase: expect.anything(),
			businessId: BUSINESS_ID,
			grantId: 'assist-1',
			kind: 'initial_setup'
		});
	});

	it('extends nothing without the confirmation, the grant or a valid duration, nor for admins', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		for (const entries of [{ grant_id: 'assist-1', kind: 'day' }, confirmed({ kind: 'day' }), confirmed({ grant_id: 'assist-1', kind: 'week' })]) {
			const result = (await actions.extend(makeEvent(entries) as never)) as { status: number };
			expect(result.status).toBe(400);
		}
		mocks.resolveActiveBusiness.mockResolvedValue(context('admin'));
		const admin = (await actions.extend(makeEvent(confirmed({ grant_id: 'assist-1', kind: 'day' })) as never)) as { status: number };
		expect(admin.status).toBe(403);
		expect(mocks.extendAccountAssistance).not.toHaveBeenCalled();
	});

	it('lets the owner end it after the confirmation', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		mocks.endAccountAssistance.mockResolvedValue({ id: 'assist-1' });

		await expect(
			actions.end(makeEvent(confirmed({ return_to: '/odonto/configuracion/ayuda', grant_id: 'assist-1' })) as never)
		).rejects.toMatchObject({ status: 303, location: '/odonto/configuracion/ayuda' });

		expect(mocks.endAccountAssistance).toHaveBeenCalledWith({
			supabase: expect.anything(),
			businessId: BUSINESS_ID,
			grantId: 'assist-1'
		});
	});

	it('lets the master end the assistance it is using and sends it back to the master panel', async () => {
		masterAssisting();

		await expect(
			actions.end(makeEvent(confirmed({ return_to: '/odonto/agenda', grant_id: 'assist-1' })) as never)
		).rejects.toMatchObject({ status: 303, location: '/odonto/maestro' });

		expect(mocks.endAccountAssistance).toHaveBeenCalledWith(
			expect.objectContaining({ businessId: BUSINESS_ID, grantId: 'assist-1' })
		);
	});

	it('ends nothing without the confirmation, for admins, or for the master outside the assistance', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		const unconfirmed = (await actions.end(makeEvent({ grant_id: 'assist-1' }) as never)) as { status: number };
		expect(unconfirmed.status).toBe(400);
		const missing = (await actions.end(makeEvent(confirmed()) as never)) as { status: number };
		expect(missing.status).toBe(400);

		mocks.resolveActiveBusiness.mockResolvedValue(context('admin'));
		const admin = (await actions.end(makeEvent(confirmed({ grant_id: 'assist-1' })) as never)) as { status: number };
		expect(admin.status).toBe(403);

		mocks.isMasterEmail.mockReturnValue(true);
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		const master = (await actions.end(makeEvent(confirmed({ grant_id: 'assist-1' })) as never)) as { status: number };
		expect(master.status).toBe(403);

		expect(mocks.endAccountAssistance).not.toHaveBeenCalled();
	});

	it('says why the database refused instead of redirecting as if it ended', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context('owner'));
		mocks.endAccountAssistance.mockRejectedValue(new Error('La ayuda ya no está activa.'));

		const result = (await actions.end(makeEvent(confirmed({ grant_id: 'assist-1' })) as never)) as {
			status: number;
			data: { message: string };
		};

		expect(result.status).toBe(500);
		expect(result.data.message).toBe('La ayuda ya no está activa.');
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

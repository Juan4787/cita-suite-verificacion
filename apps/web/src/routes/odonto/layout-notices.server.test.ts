import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	resolveActiveBusiness: vi.fn(),
	getNoticeSummary: vi.fn(),
	loadActiveMasterAccountAssistanceRequests: vi.fn(),
	loadAccountAssistanceView: vi.fn(),
	isMasterEmail: vi.fn(),
	loadDepositPolicyEnabled: vi.fn(),
	loadSlotReleaseNotice: vi.fn(),
	readLockedSubscriptionPrice: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: vi.fn() }));
vi.mock('$lib/server/platform/rate-limits', () => ({ RateLimitExceededError: class extends Error {} }));
vi.mock('$lib/server/access/public/business', () => ({
	demoBusinessContext: vi.fn(),
	isDefaultBusinessPendingManualSetupError: () => false,
	isDefaultBusinessSetupUnavailableError: () => false,
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: vi.fn(async () => ({})),
	createSupabaseServerClient: vi.fn(async () => ({})),
	getAuthUserId: vi.fn(async () => 'user-1'),
	getEmailFromAccessToken: vi.fn(),
	isMasterEmail: mocks.isMasterEmail
}));
vi.mock('$lib/server/patients/public/follow-ups', () => ({
	businessTodayISO: () => '2026-10-21',
	getNoticeSummary: mocks.getNoticeSummary,
	roleParticipatesInFollowUps: () => true
}));
vi.mock('$lib/server/access/public/account-assistance', () => ({
	loadAccountAssistanceView: mocks.loadAccountAssistanceView,
	loadActiveMasterAccountAssistanceRequests: mocks.loadActiveMasterAccountAssistanceRequests
}));
vi.mock('$lib/server/integrations/public/mercadopago', () => ({
	getSubscriptionAmountArs: () => 90000,
	readLockedSubscriptionPrice: mocks.readLockedSubscriptionPrice,
	subscriptionAmountFor: (locked: number | null) => locked ?? 90000
}));
vi.mock('$lib/server/patients/public/patient-permissions', () => ({ canExportPatientData: () => false }));
vi.mock('$lib/server/scheduling/public/deposits', () => ({ loadDepositPolicyEnabled: mocks.loadDepositPolicyEnabled }));
vi.mock('$lib/server/scheduling/public/slot-releases', () => ({ loadSlotReleaseNotice: mocks.loadSlotReleaseNotice }));

const { load } = await import('./+layout.server');

const event = (pathname = '/odonto/agenda') =>
	({
		locals: {
			auth: { module: 'odonto', access_token: 'test-token' },
			verifiedUser: { id: 'user-1', email: 'persona@example.test' },
			membershipCache: 'request'
		},
		fetch: vi.fn(),
		cookies: { get: vi.fn() },
		getClientAddress: () => '127.0.0.1',
		url: new URL(`http://localhost${pathname}`),
		depends: vi.fn()
	}) as never;

const notice = { count: 2, single: null, dismissalKey: 'two' };
const noNotice = { count: 0, single: null, dismissalKey: '0' };
const assistanceView = { status: 'available', grantId: null, showBanner: true, canActivate: true };
const business = {
	business: { id: 'business-1', timezone: 'America/Argentina/Buenos_Aires' },
	role: 'reception',
	canOperate: true,
	assistance: null,
	access: { canUseBusiness: true }
};

describe('shell notices', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isMasterEmail.mockReturnValue(false);
		mocks.resolveActiveBusiness.mockResolvedValue(business);
		mocks.getNoticeSummary.mockResolvedValue(notice);
		mocks.loadSlotReleaseNotice.mockResolvedValue({ count: 0, truncated: false, single: null, dismissalKey: '0' });
		mocks.loadActiveMasterAccountAssistanceRequests.mockResolvedValue([{ id: 'grant-1' }]);
		mocks.loadAccountAssistanceView.mockResolvedValue(assistanceView);
		mocks.loadDepositPolicyEnabled.mockResolvedValue(false);
		mocks.readLockedSubscriptionPrice.mockResolvedValue(null);
	});

	it('la pantalla de bloqueo ofrece el precio propio del consultorio que ya contrató', async () => {
		mocks.readLockedSubscriptionPrice.mockResolvedValue(75000);
		mocks.resolveActiveBusiness.mockResolvedValue({ ...business, role: 'owner', canOperate: false, access: { canUseBusiness: false } });
		await expect(load(event())).resolves.toMatchObject({ mpAmount: 75000 });
		expect(mocks.readLockedSubscriptionPrice).toHaveBeenCalledWith(expect.anything(), 'business-1');
	});

	it('un consultorio que opera no consulta el precio en cada página', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue({ ...business, role: 'owner' });
		await expect(load(event())).resolves.toMatchObject({ mpAmount: 90000 });
		expect(mocks.readLockedSubscriptionPrice).not.toHaveBeenCalled();
	});

	it('si no puede leer el precio, la pantalla de bloqueo ofrece el general', async () => {
		mocks.readLockedSubscriptionPrice.mockRejectedValue(new Error('sin conexión'));
		mocks.resolveActiveBusiness.mockResolvedValue({ ...business, role: 'owner', canOperate: false, access: { canUseBusiness: false } });
		await expect(load(event())).resolves.toMatchObject({ mpAmount: 90000, businessError: null });
	});

	it('passes the follow-up reminders and the help requests it read', async () => {
		mocks.isMasterEmail.mockReturnValue(true);
		await expect(load(event())).resolves.toMatchObject({
			followUps: notice,
			masterAssistanceRequests: [{ id: 'grant-1' }],
			unavailableNotices: [],
			businessError: null
		});
	});

	it('says the follow-up reminders could not be checked instead of showing none', async () => {
		mocks.getNoticeSummary.mockRejectedValue(new Error('read failed'));
		await expect(load(event())).resolves.toMatchObject({
			followUps: noNotice,
			unavailableNotices: ['follow-ups'],
			businessError: null
		});
	});

	it('avisa de los horarios liberados en toda la app, salvo en la agenda que ya los lista', async () => {
		const released = { count: 1, truncated: false, single: { id: 'r1' }, dismissalKey: 'one' };
		mocks.loadSlotReleaseNotice.mockResolvedValue(released);
		await expect(load(event('/odonto/pacientes'))).resolves.toMatchObject({ slotReleases: released, unavailableNotices: [] });
		mocks.loadSlotReleaseNotice.mockClear();
		await expect(load(event('/odonto/agenda'))).resolves.toMatchObject({ slotReleases: { count: 0, single: null } });
		expect(mocks.loadSlotReleaseNotice).not.toHaveBeenCalled();
		await expect(load(event('/odonto/agenda/semana'))).resolves.toMatchObject({ slotReleases: released });
	});

	it('no se lo muestra a quien no puede dar el horario', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue({ ...business, canOperate: false });
		await expect(load(event('/odonto/pacientes'))).resolves.toMatchObject({ slotReleases: { count: 0 }, unavailableNotices: [] });
		expect(mocks.loadSlotReleaseNotice).not.toHaveBeenCalled();
	});

	it('dice que no pudo comprobarlos en vez de mostrar que no hay ninguno', async () => {
		mocks.loadSlotReleaseNotice.mockRejectedValue(new Error('read failed'));
		await expect(load(event('/odonto/pacientes'))).resolves.toMatchObject({ slotReleases: { count: 0 }, unavailableNotices: ['slot-releases'], businessError: null });
	});

	it('says the help requests could not be checked instead of showing none', async () => {
		mocks.isMasterEmail.mockReturnValue(true);
		mocks.loadActiveMasterAccountAssistanceRequests.mockRejectedValue(new Error('read failed'));
		await expect(load(event())).resolves.toMatchObject({
			masterAssistanceRequests: [],
			followUps: notice,
			unavailableNotices: ['help-requests'],
			businessError: null
		});
	});

	it('says the configuration help could not be checked, without hiding the rest of the shell', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue({
			business: { id: 'business-1', timezone: 'America/Argentina/Buenos_Aires' },
			role: 'owner',
			assistance: null,
			access: { canUseBusiness: true }
		});
		mocks.loadAccountAssistanceView.mockRejectedValue(new Error('read failed'));
		await expect(load(event())).resolves.toMatchObject({
			accountAssistance: null,
			followUps: notice,
			unavailableNotices: ['assistance'],
			businessError: null
		});
	});

	it('offers «Señas» to the roles that record deposits while the practice asks for them', async () => {
		mocks.loadDepositPolicyEnabled.mockResolvedValue(true);
		await expect(load(event())).resolves.toMatchObject({ depositsEnabled: true, unavailableNotices: [] });
		expect(mocks.loadDepositPolicyEnabled).toHaveBeenCalledWith(expect.anything(), 'business-1');
	});

	it('does not read the deposit policy for roles that do not record deposits', async () => {
		for (const role of ['professional', 'readonly']) {
			mocks.loadDepositPolicyEnabled.mockClear();
			mocks.resolveActiveBusiness.mockResolvedValue({
				business: { id: 'business-1', timezone: 'America/Argentina/Buenos_Aires' },
				role,
				assistance: null,
				access: { canUseBusiness: true }
			});
			await expect(load(event())).resolves.toMatchObject({ depositsEnabled: false });
			expect(mocks.loadDepositPolicyEnabled).not.toHaveBeenCalled();
		}
	});

	it('says the deposits could not be checked instead of hiding them silently', async () => {
		mocks.loadDepositPolicyEnabled.mockRejectedValue(new Error('read failed'));
		await expect(load(event())).resolves.toMatchObject({
			depositsEnabled: false,
			followUps: notice,
			unavailableNotices: ['deposits'],
			businessError: null
		});
	});
});

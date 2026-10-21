import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	resolveActiveBusiness: vi.fn(),
	getNoticeSummary: vi.fn(),
	loadActiveMasterAccountAssistanceRequests: vi.fn(),
	isMasterEmail: vi.fn()
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
	loadAccountAssistanceView: vi.fn(async () => null),
	loadActiveMasterAccountAssistanceRequests: mocks.loadActiveMasterAccountAssistanceRequests
}));
vi.mock('$lib/server/integrations/public/mercadopago', () => ({ getSubscriptionAmountArs: () => 0 }));
vi.mock('$lib/server/patients/public/patient-permissions', () => ({ canExportPatientData: () => false }));

const { load } = await import('./+layout.server');

const event = () =>
	({
		locals: {
			auth: { module: 'odonto', access_token: 'test-token' },
			verifiedUser: { id: 'user-1', email: 'persona@example.test' },
			membershipCache: 'request'
		},
		fetch: vi.fn(),
		cookies: { get: vi.fn() },
		getClientAddress: () => '127.0.0.1',
		url: new URL('http://localhost/odonto/agenda'),
		depends: vi.fn()
	}) as never;

const notice = { count: 2, single: null, dismissalKey: 'two' };

describe('shell notices', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isMasterEmail.mockReturnValue(false);
		mocks.resolveActiveBusiness.mockResolvedValue({
			business: { id: 'business-1', timezone: 'America/Argentina/Buenos_Aires' },
			role: 'reception',
			assistance: null,
			access: { canUseBusiness: true }
		});
		mocks.getNoticeSummary.mockResolvedValue(notice);
		mocks.loadActiveMasterAccountAssistanceRequests.mockResolvedValue([{ id: 'grant-1' }]);
	});

	it('passes the follow-up reminders and the help requests it read', async () => {
		mocks.isMasterEmail.mockReturnValue(true);
		await expect(load(event())).resolves.toMatchObject({
			followUps: notice,
			masterAssistanceRequests: [{ id: 'grant-1' }],
			businessError: null
		});
	});

	it('says the follow-up reminders could not be checked instead of showing none', async () => {
		mocks.getNoticeSummary.mockRejectedValue(new Error('read failed'));
		await expect(load(event())).resolves.toMatchObject({ followUps: null, businessError: null });
	});

	it('says the help requests could not be checked instead of showing none', async () => {
		mocks.isMasterEmail.mockReturnValue(true);
		mocks.loadActiveMasterAccountAssistanceRequests.mockRejectedValue(new Error('read failed'));
		await expect(load(event())).resolves.toMatchObject({ masterAssistanceRequests: null, followUps: notice });
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn(),
	createSupabaseAdminClient: vi.fn(),
	resolveActiveBusiness: vi.fn(),
	confirmMpSubscriptionForBusiness: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock('$lib/server/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));
vi.mock('$lib/server/mercadopago', () => ({
	confirmMpSubscriptionForBusiness: mocks.confirmMpSubscriptionForBusiness,
	getSubscriptionAmountArs: () => 50000
}));

const { load } = await import('./+page.server');

const BUSINESS_ID = '33333333-3333-4333-8333-333333333333';
const PAGE_URL = 'https://app.test/odonto/pago/procesando';

const ownerContext = (overrides?: {
	canUseBusiness?: boolean;
	commercialAccessEnabled?: boolean;
	commercialStatus?: string;
	archivedAt?: string | null;
}) => ({
	business: { id: BUSINESS_ID, name: 'Consultorio Test' },
	role: 'owner',
	canManage: true,
	canOperate: overrides?.canUseBusiness ?? false,
	access: {
		canUseBusiness: overrides?.canUseBusiness ?? false,
		commercialAccessEnabled: overrides?.commercialAccessEnabled ?? true,
		commercialStatus: overrides?.commercialStatus ?? 'restricted',
		archivedAt: overrides?.archivedAt ?? null
	}
});

const makeEvent = (url = PAGE_URL) => ({
	locals: { auth: { access_token: 'token', refresh_token: 'r' } },
	fetch: vi.fn(),
	cookies: {},
	url: new URL(url)
});

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	mocks.createSupabaseServerClient.mockResolvedValue({ auth: {} });
	mocks.createSupabaseAdminClient.mockResolvedValue({ from: vi.fn() });
	mocks.confirmMpSubscriptionForBusiness.mockResolvedValue({
		subscriptionStatus: 'authorized',
		creditedNow: true,
		accessBlocked: false
	});
});

describe('/odonto/pago/procesando', () => {
	it('confirma el retorno contra Mercado Pago y refresca el contexto antes de habilitar', async () => {
		mocks.resolveActiveBusiness
			.mockResolvedValueOnce(ownerContext({ canUseBusiness: false }))
			.mockResolvedValueOnce(ownerContext({ canUseBusiness: true, commercialStatus: 'active' }));

		const data = (await load(makeEvent(`${PAGE_URL}?mp=retorno`) as never)) as {
			activated: boolean;
			manualBlock: boolean;
			mpReturn: { creditedNow: boolean; subscriptionStatus: string };
			mpAmount: number;
			mpReturnRequested: boolean;
		};

		expect(mocks.confirmMpSubscriptionForBusiness).toHaveBeenCalledTimes(1);
		expect(mocks.resolveActiveBusiness).toHaveBeenCalledTimes(2);
		expect(data.activated).toBe(true);
		expect(data.manualBlock).toBe(false);
		expect(data.mpReturn).toMatchObject({ creditedNow: true, subscriptionStatus: 'authorized' });
		expect(data.mpAmount).toBe(50000);
		expect(data.mpReturnRequested).toBe(true);
	});

	it('marca bloqueo manual cuando un pago no reactivaria la cuenta', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(
			ownerContext({ commercialAccessEnabled: false, commercialStatus: 'restricted' })
		);

		const data = (await load(makeEvent() as never)) as {
			activated: boolean;
			manualBlock: boolean;
		};

		expect(mocks.confirmMpSubscriptionForBusiness).not.toHaveBeenCalled();
		expect(data.activated).toBe(false);
		expect(data.manualBlock).toBe(true);
	});
});

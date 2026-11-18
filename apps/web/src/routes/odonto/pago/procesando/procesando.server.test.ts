import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn(),
	createSupabaseAdminClient: vi.fn(),
	resolveActiveBusiness: vi.fn(),
	confirmMpSubscriptionForBusiness: vi.fn(),
	readLockedSubscriptionPrice: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock('$lib/server/access/public/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));
vi.mock('$lib/server/integrations/public/mercadopago', () => ({
	confirmMpSubscriptionForBusiness: mocks.confirmMpSubscriptionForBusiness,
	readLockedSubscriptionPrice: mocks.readLockedSubscriptionPrice,
	subscriptionAmountFor: (locked: number | null) => locked ?? 50000
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
	business: { id: BUSINESS_ID, name: 'Consultorio Test', timezone: 'America/Argentina/Buenos_Aires' },
	role: 'owner',
	canManage: true,
	canOperate: overrides?.canUseBusiness ?? false,
	access: {
		paidUntil: '2026-11-19T15:00:00.000Z',
		canUseBusiness: overrides?.canUseBusiness ?? false,
		commercialAccessEnabled: overrides?.commercialAccessEnabled ?? true,
		commercialStatus: overrides?.commercialStatus ?? 'restricted',
		archivedAt: overrides?.archivedAt ?? null
	}
});

// Cliente del usuario: el último movimiento del historial, o una falla al leerlo.
const serverClient = (latestOperation: string | null, error: { message: string } | null = null) => {
	const query: Record<string, unknown> = {};
	for (const method of ['select', 'eq', 'order', 'limit']) query[method] = vi.fn(() => query);
	query.maybeSingle = vi.fn(async () => ({ data: latestOperation ? { operation: latestOperation } : null, error }));
	return { auth: {}, from: vi.fn(() => query) };
};

const makeEvent = (url = PAGE_URL) => ({
	locals: { auth: { access_token: 'token', refresh_token: 'r' } },
	fetch: vi.fn(),
	cookies: {},
	url: new URL(url)
});

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	mocks.createSupabaseServerClient.mockResolvedValue(serverClient(null));
	mocks.readLockedSubscriptionPrice.mockResolvedValue(null);
	mocks.createSupabaseAdminClient.mockResolvedValue({ from: vi.fn() });
	mocks.confirmMpSubscriptionForBusiness.mockResolvedValue({
		subscriptionStatus: 'authorized',
		creditedNow: true,
		accessBlocked: false,
		provisionalUntil: null
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
		// The refresh reads again instead of reusing this request's read from before the payment.
		expect(mocks.resolveActiveBusiness).toHaveBeenLastCalledWith(expect.objectContaining({ membershipCache: 'fresh' }));
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

	it('con acceso provisorio informa hasta cuándo y no lo presenta como pago', async () => {
		mocks.createSupabaseServerClient.mockResolvedValue(serverClient('provisional_access'));
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext({ canUseBusiness: true, commercialStatus: 'active' }));

		const data = (await load(makeEvent(`${PAGE_URL}?mp=retorno`) as never)) as {
			activated: boolean;
			provisionalUntil: string | null;
			provisionalUnknown: boolean;
		};

		expect(data.activated).toBe(true);
		expect(data.provisionalUntil).toBe('2026-11-19T15:00:00.000Z');
		expect(data.provisionalUnknown).toBe(false);
	});

	it('con el primer cobro ya acreditado no habla de acceso provisorio', async () => {
		mocks.createSupabaseServerClient.mockResolvedValue(serverClient('payment_registered'));
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext({ canUseBusiness: true, commercialStatus: 'active' }));

		const data = (await load(makeEvent(`${PAGE_URL}?mp=retorno`) as never)) as { provisionalUntil: string | null };

		expect(data.provisionalUntil).toBeNull();
	});

	it('si no puede leer el historial no inventa un acceso provisorio ni afirma un pago', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			mocks.createSupabaseServerClient.mockResolvedValue(serverClient(null, { message: 'sin conexión' }));
			mocks.resolveActiveBusiness.mockResolvedValue(ownerContext({ canUseBusiness: true, commercialStatus: 'active' }));

			const data = (await load(makeEvent(`${PAGE_URL}?mp=retorno`) as never)) as {
				provisionalUntil: string | null;
				provisionalUnknown: boolean;
			};

			expect(data.provisionalUntil).toBeNull();
			expect(data.provisionalUnknown).toBe(true);
		} finally {
			errorLog.mockRestore();
		}
	});

	it('muestra el precio propio del consultorio', async () => {
		mocks.readLockedSubscriptionPrice.mockResolvedValue(75000);
		mocks.resolveActiveBusiness.mockResolvedValue(ownerContext());

		const data = (await load(makeEvent() as never)) as { mpAmount: number };

		expect(data.mpAmount).toBe(75000);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOdontoContext: vi.fn(), createSupabaseAdminClient: vi.fn(), from: vi.fn(), rpc: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getOdontoContext }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('$lib/server/patients/public/booking-information', () => ({ bookingInformationEnabled: () => true }));

const { actions } = await import('./+page.server');

// A query builder: every chained call returns it, and awaiting it gives `result`.
const query = (result: unknown) => {
	const builder: object = new Proxy({}, {
		get: (_target, key) =>
			key === 'then'
				? (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
				: () => builder
	});
	return builder;
};

describe('booking settings save', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOdontoContext.mockResolvedValue({
			supabase: { from: mocks.from, rpc: mocks.rpc },
			business: {
				canManage: true, role: 'admin', assistance: { grantId: 'grant-1' },
				business: { id: 'business-1', address: 'Calle 1', is_active: true },
				access: { allowedCapabilities: { canUsePublicBooking: true } }
			}
		});
		mocks.rpc.mockReturnValue(query({ data: true, error: null }));
		mocks.from.mockReturnValue(query({ data: { id: 'business-1' }, error: null }));
		// Were the service role used, it would save too: the test checks which client does.
		mocks.createSupabaseAdminClient.mockResolvedValue({ from: () => query({ data: { id: 'business-1' }, error: null }) });
	});

	it('saves an assistance session under its own rules, never with the service role', async () => {
		const form = new FormData();
		form.set('enabled', 'false');
		form.set('revision', '2026-10-20T12:00:00.000Z');
		const result = await actions.set_enabled({
			request: new Request('http://localhost/odonto/configuracion/reserva-online', { method: 'POST', body: form }),
			fetch: vi.fn()
		} as never);
		expect(result).toMatchObject({ saved: true });
		expect(mocks.from).toHaveBeenCalledWith('businesses');
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
	});
});

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

	it('AF1-001: saves allow_same_day_booking true when checked and false when unchecked', async () => {
		const patches: Record<string, unknown>[] = [];
		const capturingQuery = () => {
			const builder: Record<string, unknown> = {};
			const fn = (method: string) => (...args: unknown[]) => {
				if (method === 'update' && args[0] && typeof args[0] === 'object') {
					patches.push(args[0] as Record<string, unknown>);
				}
				return proxy;
			};
			const proxy: object = new Proxy(builder, {
				get: (_target, key) =>
					key === 'then'
						? (resolve: (value: unknown) => unknown) => Promise.resolve({ data: { id: 'business-1' }, error: null }).then(resolve)
						: fn(String(key))
			});
			return proxy;
		};
		mocks.from.mockImplementation(capturingQuery);

		const enabledForm = new FormData();
		enabledForm.set('revision', '2026-10-20T12:00:00.000Z');
		enabledForm.set('max_booking_days_ahead', '30');
		enabledForm.set('min_booking_notice_minutes', '0');
		enabledForm.set('allow_same_day_booking', 'true');
		await expect(actions.save_rules({
			request: new Request('http://localhost/odonto/configuracion/reserva-online', { method: 'POST', body: enabledForm }),
			fetch: vi.fn()
		} as never)).resolves.toMatchObject({ saved: true });

		const disabledForm = new FormData();
		disabledForm.set('revision', '2026-10-20T12:00:00.000Z');
		disabledForm.set('max_booking_days_ahead', '30');
		disabledForm.set('min_booking_notice_minutes', '0');
		await expect(actions.save_rules({
			request: new Request('http://localhost/odonto/configuracion/reserva-online', { method: 'POST', body: disabledForm }),
			fetch: vi.fn()
		} as never)).resolves.toMatchObject({ saved: true });

		expect(patches[0]).toMatchObject({ allow_same_day_booking: true });
		expect(patches[1]).toMatchObject({ allow_same_day_booking: false });
	});
});

import { describe, it, expect, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
const mocks = vi.hoisted(() => ({ rpc: vi.fn().mockResolvedValue({ data: true, error: null }) }));
vi.mock('$env/dynamic/private', () => ({
	env: { BOOKING_INFORMATION_ENABLED: 'true', RATE_LIMIT_SALT: 'isolated-test-only' }
}));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: async () => ({ rpc: mocks.rpc }) }));
import { informationContext, privateInformationHeaders } from '$lib/server/patients/public/booking-information';
describe('Public information action and server rendering', () => {
	it('sets private headers once when a native POST action is followed by load in the same request', async () => {
		const applied = new Set<string>();
		const setHeaders = vi.fn((headers: Record<string, string>) => {
			for (const key of Object.keys(headers)) {
				if (applied.has(key)) throw new Error('Duplicate response header');
				applied.add(key);
			}
		});
		const locals = {} as App.Locals;
		const event = {
			params: { token: 'a'.repeat(64) },
			locals,
			setHeaders,
			fetch: vi.fn(),
			getClientAddress: () => '127.0.0.1'
		} as unknown as RequestEvent;
		await informationContext(event);
		await informationContext({ ...event, locals });
		expect(setHeaders).toHaveBeenCalledExactlyOnceWith(privateInformationHeaders);
		expect(mocks.rpc).toHaveBeenCalledTimes(2);
	});
});

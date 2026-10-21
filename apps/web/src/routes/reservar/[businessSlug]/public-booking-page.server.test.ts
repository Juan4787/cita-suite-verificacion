import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPublicBusinessBySlug: vi.fn(), loadPublicBookingPage: vi.fn(), logFailure: vi.fn() }));

vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$env/dynamic/private', () => ({ env: { DEMO_MODE: 'false', BOOKING_INTEGRATIONS_ENABLED: 'true' } }));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: mocks.logFailure }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: vi.fn(async () => ({})) }));
vi.mock('$lib/server/sites/public/booking-integration-flags', () => ({ bookingContextsAvailable: () => true }));
vi.mock('$lib/server/sites/public/booking-integrations', () => ({ loadDefaultBookingIntegration: vi.fn() }));
vi.mock('$lib/server/scheduling/public/public-booking', () => ({ getPublicBusinessBySlug: mocks.getPublicBusinessBySlug }));
vi.mock('$lib/server/scheduling/public/public-booking-page', () => ({
	loadPublicBookingPage: mocks.loadPublicBookingPage, submitPublicBookingPage: vi.fn()
}));

const { load } = await import('./+page.server');

const event = () => ({ params: { businessSlug: 'consultorio' }, fetch: vi.fn() }) as never;

describe('public booking page', () => {
	beforeEach(() => vi.clearAllMocks());

	it('records why it answered 503, so an outage leaves a cause in the logs', async () => {
		mocks.getPublicBusinessBySlug.mockRejectedValue(new Error('upstream unavailable'));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
		expect(mocks.logFailure).toHaveBeenCalledTimes(1);
		expect(mocks.loadPublicBookingPage).not.toHaveBeenCalled();
	});
});

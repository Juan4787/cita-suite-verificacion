// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			verifiedUser?: { id: string; email: string | null } | null;
			/** How this request's loads read memberships; set by hooks from the method. */
			membershipCache?: 'fresh' | 'request';
			bookingInformationHeadersApplied?: boolean;
			bookingFrameAncestors?: string[];
			bookingIntegrationRequest?: { publicKey: string; promise: Promise<import('$lib/server/sites/public/booking-integration-request').ResolvedBookingIntegration> };
			auth: {
				module: import('$lib/server/platform/supabase').Module;
				access_token: string;
				refresh_token: string;
			} | null;
		}
	}
}

export {};

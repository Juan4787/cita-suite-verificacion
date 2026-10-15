// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			bookingInformationHeadersApplied?: boolean;
			bookingFrameAncestors?: string[];
			bookingIntegrationRequest?: { publicKey: string; promise: Promise<import('$lib/server/booking-integration-request').ResolvedBookingIntegration> };
			auth: {
				module: import('$lib/server/supabase').Module;
				access_token: string;
				refresh_token: string;
			} | null;
		}
	}
}

export {};

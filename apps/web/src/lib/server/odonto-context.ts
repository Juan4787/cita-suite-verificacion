import { redirect } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	isDefaultBusinessPendingManualSetupError,
	isDefaultBusinessSetupUnavailableError,
	resolveActiveBusiness,
	type BusinessContext
} from './business';
import { RateLimitExceededError } from './rate-limits';
import { createSupabaseServerClient, getAuthUserId } from './supabase';

export type OdontoContext = {
	supabase: SupabaseClient;
	business: BusinessContext;
	userId: string;
};

export const getOdontoContext = async ({
	locals,
	fetch,
	cookies,
	membershipCache = 'fresh'
}: {
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: Cookies;
	membershipCache?: 'fresh' | 'short';
}): Promise<OdontoContext> => {
	if (!locals.auth) throw redirect(303, '/login');

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	let business: BusinessContext | null = null;
	let userId: string | null = null;
	try {
		[business, userId] = await Promise.all([
			resolveActiveBusiness({
				supabase,
				accessToken: locals.auth.access_token,
				cookies,
				membershipCache
			}),
			getAuthUserId(supabase, locals.auth.access_token)
		]);
	} catch (error) {
		if (isDefaultBusinessPendingManualSetupError(error)) {
			throw redirect(303, '/odonto/pendiente?reason=manual_setup');
		}
		if (error instanceof RateLimitExceededError) {
			throw redirect(303, '/odonto/pendiente?reason=rate_limited');
		}
		if (isDefaultBusinessSetupUnavailableError(error)) {
			console.error('No se pudo preparar el consultorio inicial', error);
			throw redirect(303, '/odonto/pendiente?reason=temporarily_unavailable');
		}
		throw error;
	}

	if (!userId) throw redirect(303, '/login');
	if (!business) throw redirect(303, '/odonto/pendiente?reason=temporarily_unavailable');

	return { supabase, business, userId };
};

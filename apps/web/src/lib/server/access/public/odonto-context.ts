import { logServerFailure } from '$lib/server/platform/logging';
import { redirect } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import type { CitaSupabaseClient } from '$lib/types/database';
import {
	isDefaultBusinessPendingManualSetupError,
	isDefaultBusinessSetupUnavailableError,
	resolveActiveBusiness,
	type BusinessContext
} from '$lib/server/access/public/business';
import { RateLimitExceededError } from '$lib/server/platform/rate-limits';
import { createSupabaseServerClient, getAuthUserId, getEmailFromAccessToken } from '$lib/server/platform/supabase';
import { env } from '$env/dynamic/private';

/** As in hooks: the email Auth verified for this request, or the demo token's claim in demo mode. */
export const verifiedRequestEmail = (locals: App.Locals): string | null =>
	(env.DEMO_MODE === 'true' ? getEmailFromAccessToken(locals.auth?.access_token) : locals.verifiedUser?.email) ?? null;

export type OdontoContext = {
	supabase: CitaSupabaseClient;
	business: BusinessContext;
	userId: string;
};

export const getOdontoContext = async ({
	locals,
	fetch,
	cookies,
	membershipCache = locals.membershipCache ?? 'fresh'
}: {
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: Cookies;
	membershipCache?: 'fresh' | 'request';
}): Promise<OdontoContext> => {
	if (!locals.auth) throw redirect(303, '/login');

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	let business: BusinessContext | null = null;
	// Normal private requests reuse the Auth identity validated by hooks. Direct
	// consumers without hooks must still validate Auth; only the explicit demo
	// profile uses its synthetic identity instead of an external provider.
	let userId = locals.verifiedUser?.id ?? null;
	if (!userId) {
		if (env.DEMO_MODE === 'true') userId = await getAuthUserId(supabase, locals.auth.access_token);
		else {
			const { data, error } = await supabase.auth.getUser(locals.auth.access_token);
			if (!error) userId = data.user?.id ?? null;
		}
	}
	if (!userId) throw redirect(303, '/login');
	try {
		business = await resolveActiveBusiness({
			supabase,
			verifiedUserId: userId,
			accessToken: locals.auth.access_token,
			cookies,
			membershipCache
		});
	} catch (error) {
		if (isDefaultBusinessPendingManualSetupError(error)) {
			throw redirect(303, '/odonto/pendiente?reason=manual_setup');
		}
		if (error instanceof RateLimitExceededError) {
			throw redirect(303, '/odonto/pendiente?reason=rate_limited');
		}
		if (isDefaultBusinessSetupUnavailableError(error)) {
			logServerFailure('No se pudo preparar el consultorio inicial', error);
			throw redirect(303, '/odonto/pendiente?reason=temporarily_unavailable');
		}
		throw error;
	}

	if (!business) throw redirect(303, '/odonto/pendiente?reason=temporarily_unavailable');

	return { supabase, business, userId };
};

import { env } from '$env/dynamic/private';
import {
	enforceRateLimitsFailOpen,
	googleAuthRateLimitRules,
	RateLimitExceededError
} from '$lib/server/rate-limits';
import { clearSupabaseOAuthCookies, createSupabaseOAuthClient } from '$lib/server/supabase';
import type { RequestHandler } from '@sveltejs/kit';

const loginWithError = (url: URL, code: string): Response => {
	const target = new URL('/login', url.origin);
	target.searchParams.set('auth_error', code);
	return redirectResponse(target.toString());
};

const redirectResponse = (location: string): Response =>
	new Response(null, {
		status: 303,
		headers: { location }
	});

export const GET: RequestHandler = async ({ url, cookies, fetch, getClientAddress }) => {
	if (env.DEMO_MODE === 'true') {
		return loginWithError(url, 'google_demo');
	}

	const mode = url.searchParams.get('mode') ?? 'login';
	const acceptedTerms = url.searchParams.get('accepted_terms') === 'true';
	if (mode === 'register' && !acceptedTerms) {
		return loginWithError(url, 'google_terms');
	}

	try {
		await enforceRateLimitsFailOpen(googleAuthRateLimitRules(getClientAddress()), {
			fetchImpl: fetch,
			logContext: 'No se pudo aplicar el control de intentos de Google Auth'
		});
	} catch (error) {
		if (error instanceof RateLimitExceededError) {
			return loginWithError(url, 'google_rate_limited');
		}
		console.error('Fallo inesperado aplicando el control de intentos de Google Auth', error);
		return loginWithError(url, 'google_start');
	}

	try {
		clearSupabaseOAuthCookies(cookies);
		const supabase = await createSupabaseOAuthClient('odonto', cookies, fetch);
		const { data, error } = await supabase.auth.signInWithOAuth({
			provider: 'google',
			options: {
				redirectTo: `${url.origin}/auth/callback`,
				scopes: 'openid email profile',
				queryParams: {
					prompt: 'select_account'
				}
			}
		});

		if (!error && typeof data.url === 'string' && data.url) {
			return redirectResponse(data.url);
		}

		console.error('Supabase Auth no pudo iniciar OAuth con Google', {
			code:
				typeof error === 'object' && error !== null && 'code' in error
					? String((error as { code?: unknown }).code ?? '')
					: ''
		});
	} catch (error) {
		console.error('No se pudo conectar con Supabase Auth para iniciar Google OAuth', error);
	}

	return loginWithError(url, 'google_start');
};

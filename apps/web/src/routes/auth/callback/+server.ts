import { dev } from '$app/environment';
import {
	clearSupabaseOAuthCookies,
	createSupabaseOAuthClient,
	getModuleEntryRoute,
	isMasterEmail
} from '$lib/server/supabase';
import { redirect, type RequestHandler } from '@sveltejs/kit';

const loginWithError = (url: URL, code: string): never => {
	const target = new URL('/login', url.origin);
	target.searchParams.set('auth_error', code);
	throw redirect(303, target.toString());
};

export const GET: RequestHandler = async ({ url, cookies }) => {
	const providerError = url.searchParams.get('error');
	if (providerError) {
		loginWithError(url, 'google_callback');
	}

	const code = url.searchParams.get('code');
	if (!code) {
		loginWithError(url, 'google_callback');
	}
	const authCode = code!;

	const oauthClient = await createSupabaseOAuthClient('odonto', cookies, fetch);
	const { data, error } = await oauthClient.auth.exchangeCodeForSession(authCode);
	clearSupabaseOAuthCookies(cookies);

	if (error || !data.session) {
		console.error('Error completando OAuth con Google', error);
		loginWithError(url, 'google_callback');
	}
	const session = data.session!;

	const email = data.user?.email?.trim().toLowerCase() ?? '';
	if (!email) {
		loginWithError(url, 'google_missing_email');
	}

	const isMaster = isMasterEmail(email);

	const cookieOptions = {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax' as const,
		maxAge: 60 * 60 * 24 * 7
	};

	cookies.set('sb-module', 'odonto', cookieOptions);
	cookies.set('sb-access-token', session.access_token, cookieOptions);
	cookies.set('sb-refresh-token', session.refresh_token, cookieOptions);

	throw redirect(303, isMaster ? '/odonto/maestro' : getModuleEntryRoute('odonto'));
};

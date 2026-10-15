import { ACTIVE_BUSINESS_COOKIE } from '$lib/server/business';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { redirect, type RequestHandler } from '@sveltejs/kit';

const cookieOptions = { path: '/' };

const clearSessionCookies = (cookies: Parameters<RequestHandler>[0]['cookies']) => {
	cookies.delete('sb-module', cookieOptions);
	cookies.delete('sb-access-token', cookieOptions);
	cookies.delete('sb-refresh-token', cookieOptions);
	cookies.delete(ACTIVE_BUSINESS_COOKIE, cookieOptions);
};

const errorStatus = (error: unknown) =>
	typeof error === 'object' && error !== null && 'status' in error
		? Number((error as { status?: unknown }).status)
		: 0;

/**
 * A logout is deliberately POST-only. A GET logout would let prefetchers and
 * crawlers sign a professional out merely by following a link. The POST also
 * revokes Supabase refresh tokens globally before the browser cookies are
 * cleared, so another device cannot silently refresh the same session.
 */
export const POST: RequestHandler = async ({ cookies, locals, fetch }) => {
	let remoteLogoutFailed = false;

	if (locals.auth) {
		try {
			const supabase = await createSupabaseServerClient(locals.auth.module, locals.auth, fetch);
			const { error } = await supabase.auth.admin.signOut(locals.auth.access_token, 'global');
			const status = errorStatus(error);
			// An already invalid/revoked token is safe to treat as logged out. Any
			// other response means we cannot honestly confirm remote revocation.
			if (error && ![401, 403, 404].includes(status)) {
				remoteLogoutFailed = true;
				console.error('No se pudo confirmar el cierre remoto de sesión', {
					status: status || null,
					code: 'remote_logout_failed'
				});
			}
		} catch (error) {
			remoteLogoutFailed = true;
			console.error('No se pudo conectar para cerrar la sesión remotamente', {
				status: errorStatus(error) || null,
				code: 'remote_logout_unavailable'
			});
		}
	}

	clearSessionCookies(cookies);
	throw redirect(303, remoteLogoutFailed ? '/login?auth_error=logout_failed' : '/login');
};

/**
 * Keep the old URL harmless: visiting it must never revoke a session or clear
 * cookies, including when a browser prefetches a link.
 */
export const GET: RequestHandler = () =>
	new Response('Usá el botón Salir para cerrar la sesión.', {
		status: 405,
		headers: {
			allow: 'POST',
			'cache-control': 'no-store',
			'content-type': 'text/plain; charset=utf-8'
		}
	});

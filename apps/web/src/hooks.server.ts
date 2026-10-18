import { dev } from '$app/environment';
import {
	createSupabaseServerClient,
	parseModule,
	getEmailFromAccessToken,
	getModuleEntryRoute,
	isJwtExpired,
	isMasterEmail,
	type Module
} from '$lib/server/platform/supabase';
import { ACTIVE_BUSINESS_COOKIE } from '$lib/server/access/public/business';
import { redirect, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { logServerFailure } from '$lib/server/platform/logging';
import type { HandleServerError } from '@sveltejs/kit';

// Unhandled provider errors may carry SQL details or signed URLs. The framework
// must use the same bounded diagnostic boundary as explicitly handled failures.
export const handleError: HandleServerError = ({ error }) => {
	logServerFailure('request.unexpected_failure', error);
	return { message: 'No pudimos completar la acción. Volvé a intentar en unos momentos.' };
};

const moduleHome = (module: Module) => getModuleEntryRoute(module);
const toHost = (value?: string | null) => {
	if (!value) return null;
	try {
		return new URL(value).host.toLowerCase();
	} catch {
		return null;
	}
};

const supabaseHosts = new Set(
	[toHost(env.ODONTO_SUPABASE_URL), toHost(env.ADMIN_SUPABASE_URL)].filter(
		(host): host is string => Boolean(host)
	)
);

// Una caída o rate-limit de Auth no invalida una sesión. Borrar cookies ante un
// fallo transitorio expulsa a profesionales legítimos y, peor aún, los lleva a
// creer que perdieron su trabajo. Sólo los errores explícitamente transitorios
// conservan las credenciales y devuelven 503; un error de autenticidad ambiguo
// sigue cerrándose de forma segura.
const isTransientAuthError = (error: unknown): boolean => {
	const candidate = error as { status?: number; statusCode?: number; name?: string; message?: string };
	const status = Number(candidate?.status ?? candidate?.statusCode ?? 0);
	if (status === 408 || status === 429 || status >= 500) return true;
	const descriptor = `${candidate?.name ?? ''} ${candidate?.message ?? ''}`.toLowerCase();
	return /retryable|fetch failed|network|timed? ?out|econn|enotfound|socket|temporar/.test(descriptor);
};

const authUnavailableResponse = () =>
	new Response(
		'No pudimos validar tu sesión porque el servicio de acceso está momentáneamente no disponible. Tus datos no se modificaron. Esperá unos segundos y volvé a intentar.',
		{
			status: 503,
			headers: {
				'content-type': 'text/plain; charset=utf-8',
				'cache-control': 'no-store',
				'retry-after': '10',
				'strict-transport-security': 'max-age=31536000',
				'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
				'x-content-type-options': 'nosniff',
				'x-frame-options': 'DENY',
				'referrer-policy': 'no-referrer',
				'permissions-policy': 'camera=(), microphone=(), geolocation=()'
			}
		}
	);

export const handle: Handle = async ({ event, resolve }) => {
	// Assigned only after this request's Auth response is verified. A decoded
	// cookie payload is not the identity exposed to private request contexts.
	event.locals.verifiedUser = null;
	const startedAt = performance.now();
	let authMs = 0;
	let dbQ = 0;
	let dbMs = 0;
	let dbMaxMs = 0;

	const originalFetch = event.fetch;
	event.fetch = async (input, init) => {
		const urlRaw =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		let parsed: URL | null = null;
		try {
			parsed = new URL(urlRaw, event.url.origin);
		} catch {
			parsed = null;
		}

		const isSupabaseRequest = Boolean(parsed && supabaseHosts.has(parsed.host.toLowerCase()));
		const pathname = parsed?.pathname ?? '';
		const isRestRequest = isSupabaseRequest && pathname.startsWith('/rest/v1/');
		const isAuthRequest = isSupabaseRequest && pathname.startsWith('/auth/v1/');
		const fetchStart = performance.now();
		const response = await originalFetch(input, init);
		const fetchMs = performance.now() - fetchStart;

		if (isRestRequest || isAuthRequest) {
			dbQ += 1;
			dbMs += fetchMs;
			dbMaxMs = Math.max(dbMaxMs, fetchMs);
		}
		if (isAuthRequest) authMs += fetchMs;
		return response;
	};

	const moduleCookie = parseModule(event.cookies.get('sb-module'));
	const accessToken = event.cookies.get('sb-access-token');
	const refreshToken = event.cookies.get('sb-refresh-token');
	// These entry points authenticate their own booking token, provider state,
	// signature or job credential. Unrelated user cookies must neither identify
	// their actor nor prevent their authorization from running.
	const path = event.url.pathname;
	const independentAuthorization = ['/reservar/', '/embed/v1/', '/turno/', '/api/public/', '/internal/jobs/']
		.some(prefix => path.startsWith(prefix)) ||
		['/api/mercadopago/webhook', '/api/whatsapp/webhook', '/oauth/google-calendar/callback'].includes(path);

	event.locals.auth =
		!independentAuthorization && moduleCookie && accessToken && refreshToken
			? { module: moduleCookie, access_token: accessToken, refresh_token: refreshToken }
			: null;

	const clearAuthCookies = () => {
		const options = { path: '/' };
		event.cookies.delete('sb-module', options);
		event.cookies.delete('sb-access-token', options);
		event.cookies.delete('sb-refresh-token', options);
		event.cookies.delete(ACTIVE_BUSINESS_COOKIE, options);
	};

	const isDemo = env.DEMO_MODE === 'true';
	if (event.locals.auth && !isDemo) {
		try {
			const supabase = await createSupabaseServerClient(
				event.locals.auth.module,
				null,
				event.fetch
			);
			if (isJwtExpired(event.locals.auth.access_token)) {
				const { data, error } = await supabase.auth.refreshSession({
					refresh_token: event.locals.auth.refresh_token
				});
				if (error || !data.session) {
					throw error ?? new Error('No se pudo refrescar la sesión');
				}

				const session = data.session;
				const user = data.user ?? session.user;
				if (!user?.id) throw new Error('Sesión sin identidad verificada');
				event.locals.verifiedUser = { id: user.id, email: user.email ?? null };
				const cookieOptions = {
					path: '/',
					httpOnly: true,
					secure: !dev,
					sameSite: 'lax' as const,
					maxAge: 60 * 60 * 24 * 7
				};

				event.cookies.set('sb-module', event.locals.auth.module, cookieOptions);
				event.cookies.set('sb-access-token', session.access_token, cookieOptions);
				event.cookies.set('sb-refresh-token', session.refresh_token, cookieOptions);
				event.locals.auth = {
					module: event.locals.auth.module,
					access_token: session.access_token,
					refresh_token: session.refresh_token
				};
			} else {
				// getClaims puede validar la firma localmente y una caché en memoria
				// permite que un token revocado siga funcionando en otro request. La
				// revocación global de logout debe ser efectiva inmediatamente, también
				// entre isolates de Cloudflare, por eso consultamos Auth en cada request.
				const { data, error } = await supabase.auth.getUser(event.locals.auth.access_token);
				if (error || !data?.user?.id) {
					throw error ?? new Error('Sesión inválida');
				}
				event.locals.verifiedUser = { id: data.user.id, email: data.user.email ?? null };
			}
		} catch (err) {
			if (isTransientAuthError(err)) return authUnavailableResponse();
			clearAuthCookies();
			throw redirect(303, '/login');
		}
	}

	const { pathname } = event.url;
	const wantsOdonto = pathname.startsWith('/odonto');
	const wantsAdmin = pathname.startsWith('/administrativo');
	const wantsMaster = pathname.startsWith('/odonto/maestro');
	const protectedRoute = wantsOdonto || wantsAdmin || wantsMaster;

	if (!event.locals.auth && protectedRoute) {
		throw redirect(303, '/login');
	}

	if (event.locals.auth) {
		const email = isDemo
			? getEmailFromAccessToken(event.locals.auth.access_token)
			: event.locals.verifiedUser?.email;
		const isMaster = isMasterEmail(email);

		if (wantsMaster && !isMaster) {
			throw redirect(303, moduleHome('odonto'));
		}

		// Administrativo deshabilitado por ahora.
		if (wantsAdmin) {
			throw redirect(303, moduleHome('odonto'));
		}

		if (event.locals.auth.module === 'odonto' && wantsAdmin) {
			throw redirect(303, moduleHome('odonto'));
		}
		if (event.locals.auth.module === 'administrativo' && wantsOdonto) {
			throw redirect(303, moduleHome('odonto'));
		}
	}

	const response = await resolve(event);
	// Only a validated public integration may opt into framing. Private routes
	// and every rejected/unknown integration retain DENY.
	if (event.locals.bookingFrameAncestors?.length) {
		response.headers.delete('x-frame-options');
		const policy = (response.headers.get('content-security-policy') ?? '')
			.split(';').filter((directive) => !directive.trim().startsWith('frame-ancestors')).join(';');
		response.headers.set('content-security-policy', policy + "; frame-ancestors " + event.locals.bookingFrameAncestors.join(' '));
	}
	const securityHeaders: Record<string, string> = {
		...(event.url.pathname.startsWith('/embed/v1/') ? { 'cache-control': 'no-store' } : {}),
		'strict-transport-security': 'max-age=31536000',
		'x-content-type-options': 'nosniff',
		...(event.locals.bookingFrameAncestors?.length ? {} : { 'x-frame-options': 'DENY' }),
		'referrer-policy': 'strict-origin-when-cross-origin',
		'permissions-policy': 'camera=(), microphone=(), geolocation=()'
	};
	for (const [name, value] of Object.entries(securityHeaders)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}

	const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
	const isServerRenderedPage = response.headers.get('x-sveltekit-page') === 'true' || contentType.startsWith('text/html');
	if ((event.locals.auth || isServerRenderedPage) && !response.headers.has('cache-control')) {
		response.headers.set('cache-control', 'private, no-store');
	}

	const totalMs = performance.now() - startedAt;
	const loadMs = Math.max(totalMs - authMs, 0);
	const runtimeRegion = String(env.AWS_REGION ?? 'unknown').replace(
		/[^a-zA-Z0-9_-]/g,
		''
	);
	const timingValue = [
		`auth;dur=${authMs.toFixed(1)}`,
		`load;dur=${loadMs.toFixed(1)}`,
		`db;dur=${dbMs.toFixed(1)}`,
		`db_max;dur=${dbMaxMs.toFixed(1)}`,
		`db_q;desc="${dbQ}"`,
		`runtime_region;desc="${runtimeRegion || 'unknown'}"`
	].join(', ');
	const existingTiming = response.headers.get('Server-Timing');
	response.headers.set('Server-Timing', existingTiming ? `${existingTiming}, ${timingValue}` : timingValue);
	return response;
};

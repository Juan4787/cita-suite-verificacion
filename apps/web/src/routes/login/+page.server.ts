import { env } from '$env/dynamic/private';
import {
	createSupabaseServerClient,
	getModuleEntryRoute,
	isMasterEmail,
	MASTER_EMAIL
} from '$lib/server/supabase';
import {
	enforceRateLimitsFailOpen,
	loginPasswordRateLimitRules,
	RateLimitExceededError,
	signupEmailRateLimitRules
} from '$lib/server/rate-limits';
import { dev } from '$app/environment';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const LOGIN_UNAVAILABLE_MESSAGE =
	'El ingreso no está disponible en este momento. Probá de nuevo en unos minutos. Si continúa, contactá a soporte.';
const REGISTER_UNAVAILABLE_MESSAGE =
	'No podemos crear tu cuenta en este momento. Probá de nuevo en unos minutos. Si continúa, contactá a soporte.';

const authErrorStatus = (error: unknown) =>
	typeof error === 'object' && error !== null && 'status' in error
		? Number((error as { status?: unknown }).status)
		: 0;

const authErrorCode = (error: unknown) =>
	typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code ?? '')
		: '';

const authErrorMessage = (value?: string | null) => {
	if (value === 'google_callback') {
		return 'No pudimos completar el ingreso con Google. Probá otra vez.';
	}
	if (value === 'google_missing_email') {
		return 'Google no devolvió un email válido para esta cuenta.';
	}
	if (value === 'google_terms') {
		return 'Para crear la cuenta con Google tenés que aceptar los términos y condiciones.';
	}
	if (value === 'google_start') {
		return 'El ingreso con Google no está disponible en este momento. Probá de nuevo en unos minutos o ingresá con correo y contraseña.';
	}
	if (value === 'google_demo') {
		return 'Ingreso con Google no disponible en modo demo.';
	}
	if (value === 'google_rate_limited') {
		return 'Hay demasiados intentos con Google desde esta conexión. Probá de nuevo más tarde.';
	}
	if (value === 'logout_failed') {
		return 'Cerramos esta sesión en este dispositivo, pero no pudimos confirmar el cierre en los demás. Volvé a intentar antes de continuar.';
	}
	return null;
};

const loginFail = (status: number, message: string, email: string) =>
	fail(status, { mode: 'login' as const, message, email });

const registerFail = (
	status: number,
	message: string,
	email: string,
	acceptedTerms = false
) => fail(status, { mode: 'register' as const, message, email, acceptedTerms });

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.auth) {
		throw redirect(302, getModuleEntryRoute(locals.auth.module));
	}
	return {
		message: authErrorMessage(url.searchParams.get('auth_error'))
	};
};

export const actions: Actions = {
	login: async ({ request, cookies, fetch, getClientAddress }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return loginFail(400, 'Completá correo electrónico y contraseña.', email);
		}

		const isMaster = isMasterEmail(email);

		if (env.DEMO_MODE === 'true') {
			const cookieOptions = {
				path: '/',
				httpOnly: true,
				secure: !dev,
				sameSite: 'lax' as const,
				maxAge: 60 * 60 * 24 * 7
			};
			cookies.set('sb-module', 'odonto', cookieOptions);
			cookies.set('sb-access-token', 'demo', cookieOptions);
			cookies.set('sb-refresh-token', 'demo', cookieOptions);
			throw redirect(303, getModuleEntryRoute('odonto'));
		}

		try {
			await enforceRateLimitsFailOpen(loginPasswordRateLimitRules(email, getClientAddress()), {
				fetchImpl: fetch,
				logContext: 'No se pudo aplicar el control de intentos de ingreso'
			});
		} catch (error) {
			if (error instanceof RateLimitExceededError) {
				return loginFail(error.status, error.userMessage, email);
			}
			console.error('Fallo inesperado aplicando el control de intentos de ingreso', error);
			return loginFail(503, LOGIN_UNAVAILABLE_MESSAGE, email);
		}

		let authResult;
		try {
			const supabase = await createSupabaseServerClient('odonto', null, fetch);
			authResult = await supabase.auth.signInWithPassword({ email, password });
		} catch (error) {
			console.error('No se pudo conectar con Supabase Auth durante el ingreso', error);
			return loginFail(503, LOGIN_UNAVAILABLE_MESSAGE, email);
		}
		const { data, error } = authResult;

		if (error || !data.session) {
			const code = authErrorCode(error);
			const status = authErrorStatus(error);
			const msg = error?.message?.toLowerCase() ?? '';
			if ((error as any)?.code === 'email_provider_disabled' || msg.includes('email logins are disabled')) {
				console.error('El proveedor de ingreso por email no está disponible', { code, status });
				return loginFail(503, LOGIN_UNAVAILABLE_MESSAGE, email);
			}
			if (msg.includes('email not confirmed')) {
				return loginFail(400, 'Tu correo electrónico todavía no está confirmado.', email);
			}
			if (msg.includes('invalid api key') || msg.includes('invalid jwt') || msg.includes('jwt')) {
				console.error('Supabase Auth rechazó la configuración del ingreso', { code, status });
				return loginFail(503, LOGIN_UNAVAILABLE_MESSAGE, email);
			}
			if (status === 429) {
				return loginFail(
					429,
					'Hay demasiados intentos de ingreso. Esperá unos minutos antes de volver a probar.',
					email
				);
			}
			if (status >= 500) {
				console.error('Supabase Auth no pudo completar el ingreso', { code, status });
				return loginFail(503, LOGIN_UNAVAILABLE_MESSAGE, email);
			}
			if (code && code !== 'invalid_credentials') {
				console.warn('Supabase Auth rechazó el ingreso', { code, status });
			}
			return loginFail(400, 'Credenciales inválidas', email);
		}

		const session = data.session;
		const cookieOptions = {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax' as const,
			maxAge: 60 * 60 * 24 * 7 // 7 días
		};

		cookies.set('sb-module', 'odonto', cookieOptions);
		cookies.set('sb-access-token', session.access_token, cookieOptions);
		cookies.set('sb-refresh-token', session.refresh_token, cookieOptions);

		if (isMaster) {
			throw redirect(303, '/odonto/maestro');
		}

		throw redirect(303, getModuleEntryRoute('odonto'));
	},
	register: async ({ request, cookies, fetch, getClientAddress }) => {
		if (env.DEMO_MODE === 'true') {
			return registerFail(400, 'Registro no disponible en modo demo', '');
		}

		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');
		const confirmPassword = String(form.get('confirm_password') ?? '');
		const acceptedTerms = form.get('accepted_terms') === 'true';

		if (!email || !password) {
			return registerFail(400, 'Completá correo electrónico y contraseña.', email, acceptedTerms);
		}
		if (password !== confirmPassword) {
			return registerFail(400, 'Las contraseñas no coinciden.', email, acceptedTerms);
		}
		if (!acceptedTerms) {
			return registerFail(
				400,
				'Para crear la cuenta tenés que aceptar los términos y condiciones.',
				email,
				acceptedTerms
			);
		}
		if (password.length < 6) {
			return registerFail(
				400,
				'La contraseña debe tener al menos 6 caracteres',
				email,
				acceptedTerms
			);
		}

		if (isMasterEmail(email)) {
			return registerFail(
				400,
				`El correo maestro (${MASTER_EMAIL}) no se registra acá.`,
				email,
				acceptedTerms
			);
		}

		try {
			await enforceRateLimitsFailOpen(signupEmailRateLimitRules(email, getClientAddress()), {
				fetchImpl: fetch,
				logContext: 'No se pudo aplicar el control de intentos de registro'
			});
		} catch (error) {
			if (error instanceof RateLimitExceededError) {
				return registerFail(error.status, error.userMessage, email, acceptedTerms);
			}
			console.error('Fallo inesperado aplicando el control de intentos de registro', error);
			return registerFail(503, REGISTER_UNAVAILABLE_MESSAGE, email, acceptedTerms);
		}

		let authResult;
		try {
			const supabase = await createSupabaseServerClient('odonto', null, fetch);
			authResult = await supabase.auth.signUp({ email, password });
		} catch (error) {
			console.error('No se pudo conectar con Supabase Auth durante el registro', error);
			return registerFail(503, REGISTER_UNAVAILABLE_MESSAGE, email, acceptedTerms);
		}
		const { data, error } = authResult;
		if (error) {
			const code = authErrorCode(error);
			const status = authErrorStatus(error);
			const msg = error?.message?.toLowerCase() ?? '';
			if (msg.includes('user already registered') || msg.includes('already registered')) {
				return registerFail(
					400,
					'Ese correo electrónico ya está registrado. Ingresá con tu contraseña.',
					email,
					acceptedTerms
				);
			}
			if (status === 429) {
				return registerFail(
					429,
					'Hay demasiados intentos de registro. Esperá unos minutos antes de volver a probar.',
					email,
					acceptedTerms
				);
			}
			if (
				status >= 500 ||
				msg.includes('invalid api key') ||
				msg.includes('invalid jwt') ||
				msg.includes('email provider is disabled')
			) {
				console.error('Supabase Auth no pudo completar el registro', { code, status });
				return registerFail(503, REGISTER_UNAVAILABLE_MESSAGE, email, acceptedTerms);
			}
			console.warn('Supabase Auth rechazó el registro', { code, status });
			return registerFail(
				400,
				'No pudimos crear la cuenta. Revisá los datos e intentá de nuevo.',
				email,
				acceptedTerms
			);
		}

		if (!data.session) {
			return registerFail(
				400,
				'La cuenta se creó pero falta confirmar el correo electrónico.',
				email,
				acceptedTerms
			);
		}

		const cookieOptions = {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax' as const,
			maxAge: 60 * 60 * 24 * 7
		};

		cookies.set('sb-module', 'odonto', cookieOptions);
		cookies.set('sb-access-token', data.session.access_token, cookieOptions);
		cookies.set('sb-refresh-token', data.session.refresh_token, cookieOptions);

		throw redirect(303, getModuleEntryRoute('odonto'));
	}
};

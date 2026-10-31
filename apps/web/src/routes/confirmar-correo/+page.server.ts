import { env } from '$env/dynamic/private';
import { fail, redirect } from '@sveltejs/kit';
import { EMAIL_CONFIRMATION_PATH, validConfirmationAccessToken, validConfirmationEmail } from '$lib/access/email-confirmation';
import { emailConfirmationRedirect, readConfirmationForm, readEmailConfirmation, writeEmailConfirmation } from '$lib/server/access/public/email-confirmation';
import { createSupabaseServerClient, getModuleEntryRoute } from '$lib/server/platform/supabase';
import { enforceRateLimitsFailOpen, signupEmailRateLimitRules, RateLimitExceededError } from '$lib/server/platform/rate-limits';
import { logServerFailure } from '$lib/server/platform/logging';
import type { Actions, PageServerLoad } from './$types';

const badLink = 'Este enlace ya se usó o venció. Si ya confirmaste tu correo, podés ingresar. Si todavía no lo confirmaste, pedí un nuevo enlace.';
export const load: PageServerLoad = ({ cookies, locals }) => ({
	context: readEmailConfirmation(cookies), currentEmail: locals.verifiedUser?.email ?? null,
	entryRoute: locals.auth ? getModuleEntryRoute(locals.auth.module) : '/login'
});

export const actions: Actions = {
	resend: async ({ request, cookies, fetch, getClientAddress }) => {
		let email = '';
		try { email = String((await readConfirmationForm(request)).get('email') ?? '').trim().toLowerCase(); }
		catch { return fail(400, { kind: 'error' as const, message: 'Revisá el correo antes de pedir un nuevo enlace.' }); }
		if (!validConfirmationEmail(email)) return fail(400, { kind: 'error' as const, message: 'Ingresá un correo electrónico válido.' });
		if (env.DEMO_MODE === 'true') return fail(400, { kind: 'notice' as const, message: 'El envío no está disponible en la demostración.' });
		const previous = readEmailConfirmation(cookies);
		if (previous?.email === email && previous.status === 'confirmed') throw redirect(303, '/login');
		if (previous?.email === email && previous.resendAfter > Date.now()) return fail(429, {
			kind: 'notice' as const, message: 'Esperá un minuto antes de pedir otro correo.', resendAfter: previous.resendAfter
		});
		try {
			await enforceRateLimitsFailOpen(signupEmailRateLimitRules(email, getClientAddress()), { fetchImpl: fetch, logContext: 'No se pudo comprobar el límite de confirmación de correo' });
			const client = await createSupabaseServerClient('odonto', null, fetch);
			const { error } = await client.auth.resend({ type: 'signup', email, options: {
				emailRedirectTo: emailConfirmationRedirect(request.url)
			} });
			if (error?.status === 429) {
				writeEmailConfirmation(cookies, email, 'pending', true);
				return fail(429, { kind: 'notice' as const, message: 'Esperá un momento antes de pedir otro correo.', resendAfter: Date.now() + 60_000 });
			}
			// This identical answer for known/unknown accounts avoids an email directory.
			if (error && !['user_not_found', 'email_not_confirmed'].includes(error.code ?? '')) {
				logServerFailure('No se pudo solicitar el correo de confirmación', { status: error.status, code: error.code });
				return fail(503, { kind: 'error' as const, message: 'No pudimos pedir el correo en este momento. Probá de nuevo en unos minutos.' });
			}
			writeEmailConfirmation(cookies, email, 'pending', true);
			return { kind: 'notice' as const, message: 'Si tu cuenta necesita confirmación, vas a recibir un nuevo enlace. Revisá también el correo no deseado.', resendAfter: Date.now() + 60_000 };
		} catch (error) {
			if (error instanceof RateLimitExceededError) return fail(429, { kind: 'notice' as const, message: 'Ya pediste varios correos. Esperá un rato antes de volver a intentar.' });
			logServerFailure('No se pudo conectar para confirmar el correo', { code: 'confirmation_resend_unavailable' });
			return fail(503, { kind: 'error' as const, message: 'No pudimos pedir el correo en este momento. Probá de nuevo en unos minutos.' });
		}
	},
	confirm: async ({ request, cookies, fetch }) => {
		let token = '', type = '';
		try { const form = await readConfirmationForm(request); token = form.get('access_token') ?? ''; type = form.get('type') ?? ''; }
		catch { return fail(400, { kind: 'invalid' as const, message: badLink }); }
		if (!validConfirmationAccessToken(token) || !['signup', 'email'].includes(type)) return fail(400, { kind: 'invalid' as const, message: badLink });
		let email: string | null = null;
		try {
			const client = await createSupabaseServerClient('odonto', null, fetch);
			const { data, error } = await client.auth.getUser(token);
			if (error && (Number(error.status) >= 500 || Number(error.status) === 429)) {
				logServerFailure('No se pudo comprobar el enlace de confirmación de correo', { status: error.status, code: error.code });
				return fail(503, { kind: 'error' as const, message: 'No pudimos comprobar el enlace en este momento. Podés intentar ingresar o pedir uno nuevo.' });
			}
			if (error || !data.user?.email_confirmed_at || !data.user.email) return fail(410, { kind: 'invalid' as const, message: badLink });
			email = data.user.email.trim().toLowerCase();
			if (!validConfirmationEmail(email)) return fail(410, { kind: 'invalid' as const, message: badLink });
		} catch {
			// Like resend: a fixed code, never the link's token or the raw provider error.
			logServerFailure('No se pudo conectar para comprobar el enlace de confirmación', { code: 'confirmation_verify_unavailable' });
			return fail(503, { kind: 'error' as const, message: 'No pudimos comprobar el enlace en este momento. Podés intentar ingresar o pedir uno nuevo.' });
		}
		// A verified address is not a login. Do not create or replace another user's session.
		writeEmailConfirmation(cookies, email, 'confirmed');
		throw redirect(303, EMAIL_CONFIRMATION_PATH);
	}
};

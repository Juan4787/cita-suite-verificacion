import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { PUBLIC_SITE_URL_FALLBACK } from '$lib/constants';
import { createSupabaseServerClient } from '$lib/server/platform/supabase';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return {};
};

export const actions: Actions = {
	default: async ({ request, fetch }) => {
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo' });
		}

		const form = await request.formData();
		const rawEmail = form.get('email');
		const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';

		if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return fail(400, { message: 'Ingresá un correo electrónico válido.', email });
		}

		try {
			const supabase = await createSupabaseServerClient('odonto', null, fetch);
			const rawSiteUrl = publicEnv.PUBLIC_SITE_URL?.trim() ?? '';
			const baseUrl = rawSiteUrl.replace(/\/+$/, '');
			const redirectTo = `${baseUrl || PUBLIC_SITE_URL_FALLBACK}/reset/callback`;

			const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

			if (error) {
				logServerFailure('Error reset password', error);
				if (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') {
					return fail(429, { message: 'Hay demasiadas solicitudes. Esperá unos minutos y volvé a intentar.', email });
				}
				return fail(503, { message: 'No pudimos enviar el correo. Intentá de nuevo en unos minutos.', email });
			}
			return { success: true, email };
		} catch (error) {
			logServerFailure('No se pudo solicitar la recuperación de contraseña', error);
			return fail(503, { message: 'No pudimos enviar el correo. Intentá de nuevo en unos minutos.', email });
		}
	}
};

import { env } from '$env/dynamic/private';
import { PUBLIC_SITE_URL_FALLBACK } from '$lib/constants';
import { createSupabaseServerClient } from '$lib/server/supabase';
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
		const email = String(form.get('email') ?? '').trim().toLowerCase();

		if (!email) {
			return fail(400, { message: 'Ingresá un correo electrónico válido.', email });
		}

		const supabase = await createSupabaseServerClient('odonto', null, fetch);
		const rawSiteUrl = (env as Record<string, string | undefined>).PUBLIC_SITE_URL ?? '';
		const baseUrl = rawSiteUrl ? rawSiteUrl.replace(/\/+$/, '') : '';
		const redirectTo = `${baseUrl || PUBLIC_SITE_URL_FALLBACK}/reset/callback`;

		const { error } = await supabase.auth.resetPasswordForEmail(email, {
			redirectTo
		});

		if (error) {
			console.error('Error reset password', error);
			return fail(500, { message: 'No pudimos enviar el correo. Intentá de nuevo.', email });
		}

		return { success: true, email };
	}
};

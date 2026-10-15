import { env } from '$env/dynamic/private';
import {
	accountAssistanceErrorMessage,
	activateAccountAssistance,
	buildAccountAssistanceView,
	dismissAccountAssistanceNotice,
	loadAccountAssistanceView,
	revokeAccountAssistance,
	safeAssistanceReturnTo
} from '$lib/server/account-assistance';
import { demoBusinessContext, resolveActiveBusiness } from '$lib/server/business';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getEmailFromAccessToken,
	isMasterEmail
} from '$lib/server/supabase';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const isMasterSession = (locals: App.Locals) =>
	isMasterEmail(getEmailFromAccessToken(locals.auth?.access_token));

const loadContext = async ({
	locals,
	fetch,
	cookies
}: {
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: import('@sveltejs/kit').Cookies;
}) => {
	if (!locals.auth) throw redirect(303, '/login');
	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	return { supabase, context };
};

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		const context = demoBusinessContext();
		return {
			context,
			assistance: buildAccountAssistanceView({
				grant: null,
				role: 'owner',
				timeZone: context.business.timezone,
				canUseBusiness: true
			}),
			demo: true
		};
	}

	const { supabase, context } = await loadContext({ locals, fetch, cookies });
	if (isMasterSession(locals) && !context.assistance) throw redirect(303, '/odonto/maestro');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context.role !== 'owner' && context.role !== 'admin') throw redirect(303, '/odonto/agenda');

	const assistance = await loadAccountAssistanceView({
		supabase,
		businessId: context.business.id,
		role: context.role,
		timeZone: context.business.timezone,
		canUseBusiness: context.access.canUseBusiness,
		isAssisting: Boolean(context.assistance)
	});

	return {
		context,
		assistance,
		demo: false
	};
};

export const actions: Actions = {
	activate: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (isMasterSession(locals)) {
			return fail(403, {
				message: 'La cuenta maestra no solicita ayuda. Abrí el consultorio desde el panel maestro.'
			});
		}
		const form = await request.formData();
		const returnTo = safeAssistanceReturnTo(form.get('return_to'));
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });

		try {
			const { supabase, context } = await loadContext({ locals, fetch, cookies });
			if (context.assistance || context.role !== 'owner') {
				return fail(403, { message: 'Solo el dueño del consultorio puede activar esta ayuda.' });
			}
			if (!context.access.canUseBusiness) {
				return fail(409, { message: 'La cuenta debe estar activa para pedir ayuda de configuración.' });
			}
			const admin = await createSupabaseAdminClient('odonto', fetch);
			await activateAccountAssistance({ supabase, admin, businessId: context.business.id });
		} catch (error) {
			console.error('Error activando ayuda para configurar', error);
			return fail(500, { message: accountAssistanceErrorMessage(error) });
		}

		throw redirect(303, returnTo);
	},
	revoke: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (isMasterSession(locals)) {
			return fail(403, {
				message: 'La cuenta maestra no solicita ayuda. Abrí el consultorio desde el panel maestro.'
			});
		}
		const form = await request.formData();
		const returnTo = safeAssistanceReturnTo(form.get('return_to'));
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });

		try {
			const { supabase, context } = await loadContext({ locals, fetch, cookies });
			if (context.assistance || context.role !== 'owner') {
				return fail(403, { message: 'Solo el dueño del consultorio puede detener esta ayuda.' });
			}
			await revokeAccountAssistance({ supabase, businessId: context.business.id });
		} catch (error) {
			console.error('Error revocando ayuda para configurar', error);
			return fail(500, { message: accountAssistanceErrorMessage(error) });
		}

		throw redirect(303, returnTo);
	},
	dismiss: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (isMasterSession(locals)) {
			return fail(403, {
				message: 'La cuenta maestra no solicita ayuda. Abrí el consultorio desde el panel maestro.'
			});
		}
		const form = await request.formData();
		const returnTo = safeAssistanceReturnTo(form.get('return_to'));
		const grantId = String(form.get('grant_id') ?? '').trim();
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		if (!grantId) return fail(400, { message: 'No pudimos cerrar este aviso.' });

		try {
			const { supabase, context } = await loadContext({ locals, fetch, cookies });
			if (context.assistance || context.role !== 'owner') {
				return fail(403, { message: 'Solo el dueño del consultorio puede cerrar este aviso.' });
			}
			await dismissAccountAssistanceNotice({
				supabase,
				businessId: context.business.id,
				grantId
			});
		} catch (error) {
			console.error('Error cerrando aviso de ayuda para configurar', error);
			return fail(500, { message: accountAssistanceErrorMessage(error) });
		}

		throw redirect(303, returnTo);
	}
};

import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import {
	confirmMpSubscriptionForBusiness,
	getSubscriptionAmountArs,
	type MpReturnSummary
} from '$lib/server/mercadopago';
import { createSupabaseAdminClient, createSupabaseServerClient } from '$lib/server/supabase';
import { error as kitError, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') throw redirect(303, '/odonto');

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	let context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');

	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context.role !== 'owner' && context.role !== 'admin') throw redirect(303, '/odonto/agenda');

	let mpReturn: MpReturnSummary | null = null;
	let mpReturnFailed = false;
	const mpReturnRequested = url.searchParams.get('mp') === 'retorno';
	if (mpReturnRequested) {
		try {
			const admin = await createSupabaseAdminClient('odonto', fetch);
			mpReturn = await confirmMpSubscriptionForBusiness(admin, fetch, context.business.id);
			const refreshed = await resolveActiveBusiness({
				supabase,
				accessToken: locals.auth.access_token,
				cookies
			});
			if (refreshed) context = refreshed;
		} catch (error) {
			mpReturnFailed = true;
			console.error('No se pudo confirmar el retorno de Mercado Pago', error);
		}
	}

	const activated = context.access.canUseBusiness;
	const manualBlock = !context.access.commercialAccessEnabled || Boolean(context.access.archivedAt);

	return {
		context,
		mpAmount: getSubscriptionAmountArs(),
		mpReturn,
		mpReturnFailed,
		mpReturnRequested,
		activated,
		manualBlock
	};
};

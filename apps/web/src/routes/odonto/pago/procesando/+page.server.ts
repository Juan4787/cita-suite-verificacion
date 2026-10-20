import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/access/public/business';
import {
	confirmMpSubscriptionForBusiness,
	getSubscriptionAmountArs,
	type MpReturnSummary
} from '$lib/server/integrations/public/mercadopago';
import { createSupabaseAdminClient, createSupabaseServerClient } from '$lib/server/platform/supabase';
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
			// Una lectura nueva: el pedido ya tiene la de antes de confirmar el pago.
			const refreshed = await resolveActiveBusiness({
				supabase,
				accessToken: locals.auth.access_token,
				cookies,
				membershipCache: 'fresh'
			});
			if (refreshed) context = refreshed;
		} catch (error) {
			mpReturnFailed = true;
			logServerFailure('No se pudo confirmar el retorno de Mercado Pago', error);
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

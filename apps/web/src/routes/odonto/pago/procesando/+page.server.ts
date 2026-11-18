import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/access/public/business';
import {
	confirmMpSubscriptionForBusiness,
	readLockedSubscriptionPrice,
	subscriptionAmountFor,
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

	// El precio que se muestra es el del consultorio si ya contrató (decisión de Juan del 18-nov-2026).
	let lockedPrice: number | null = null;
	try {
		lockedPrice = await readLockedSubscriptionPrice(supabase, context.business.id);
	} catch (error) {
		logServerFailure('No se pudo leer el precio del consultorio', error);
	}

	const activated = context.access.canUseBusiness;
	// Acceso provisorio en curso: el último movimiento del historial es el provisorio. Hasta el primer
	// cobro no hay pago, y la pantalla no lo confirma como tal (20261118020000).
	let provisionalUntil: string | null = null;
	let provisionalUnknown = false;
	if (activated) {
		try {
			const { data: latest, error: latestError } = await supabase
				.from('access_grants')
				.select('operation')
				.eq('business_id', context.business.id)
				.order('created_at', { ascending: false })
				.limit(1)
				.maybeSingle();
			if (latestError) throw latestError;
			if (latest?.operation === 'provisional_access') provisionalUntil = context.access.paidUntil;
		} catch (error) {
			// Sin el dato, la pantalla no afirma un pago que no vio: sólo lo confirma si se acreditó en este retorno.
			provisionalUnknown = true;
			logServerFailure('No se pudo leer el último movimiento del acceso', error);
		}
	}
	const manualBlock = !context.access.commercialAccessEnabled || Boolean(context.access.archivedAt);

	return {
		context,
		mpAmount: subscriptionAmountFor(lockedPrice),
		mpReturn,
		mpReturnFailed,
		mpReturnRequested,
		activated,
		provisionalUntil,
		provisionalUnknown,
		manualBlock
	};
};

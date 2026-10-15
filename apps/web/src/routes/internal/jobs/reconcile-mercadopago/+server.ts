import { assertInternalJobRequest } from '$lib/server/internal-jobs';
import { reconcileMercadoPago } from '$lib/server/mercadopago';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Red de seguridad de la acreditación de pagos: agendado en cron-job.org
// (~cada 6 h, mismo esquema que los recordatorios). Sincroniza suscripciones
// contra la API de MP y acredita cobros aprobados que webhook/retorno no
// hayan registrado (idempotente).
export const POST: RequestHandler = async ({ request, fetch, url }) => {
	const unauthorized = assertInternalJobRequest(request);
	if (unauthorized) return unauthorized;

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const parsedLimit = Number(url.searchParams.get('limit'));
	const summary = await reconcileMercadoPago(admin, fetch, {
		limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20
	});
	return json(summary);
};

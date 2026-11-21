import { assertInternalJobRequest } from '$lib/server/integrations/public/internal-jobs';
import { legacyJobEntrypointsEnabled } from '$lib/server/integrations/public/scheduled-jobs';
import { processQueuedMessageDispatches } from '$lib/server/integrations/public/messaging';
import { logServerFailure } from '$lib/server/platform/logging';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch, url }) => {
	const unauthorized = assertInternalJobRequest(request);
	if (unauthorized) return unauthorized;
	try {
		if (!(await legacyJobEntrypointsEnabled(fetch))) {
			return json({ message: 'Esta entrada fue retirada: las tareas las ejecuta el programador nuevo.' }, { status: 410 });
		}
	} catch (error) {
		logServerFailure('No se pudo consultar el estado de las entradas antiguas de tareas', error);
		return json({ message: 'No se pudo consultar el estado de las tareas.' }, { status: 503 });
	}

	const supabase = await createSupabaseAdminClient('odonto', fetch);
	const result = await processQueuedMessageDispatches(supabase, {
		limit: Number(url.searchParams.get('limit') ?? 20)
	});
	return json(result);
};

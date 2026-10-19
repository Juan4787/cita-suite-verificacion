import { assertInternalJobRequest } from '$lib/server/integrations/public/internal-jobs';
import { legacyJobEntrypointsEnabled, runScheduledJob } from '$lib/server/integrations/public/scheduled-jobs';
import { logServerFailure } from '$lib/server/platform/logging';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Entrada del programador anterior (cron externo). Durante la transición ejecuta sólo
// recordatorios push, con la misma implementación presupuestada que el programador
// nuevo; calendario y reseñas tienen su propia categoría. Cuando el paso de release
// apaga las entradas antiguas responde 410 sin ejecutar nada.
export const POST: RequestHandler = async ({ request, fetch }) => {
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
	const receipt = await runScheduledJob('push', fetch);
	return json(receipt, { status: receipt.ok ? 200 : 500 });
};

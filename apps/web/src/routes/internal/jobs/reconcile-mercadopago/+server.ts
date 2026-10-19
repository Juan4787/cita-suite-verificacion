import { assertInternalJobRequest } from '$lib/server/integrations/public/internal-jobs';
import { legacyJobEntrypointsEnabled, runScheduledJob } from '$lib/server/integrations/public/scheduled-jobs';
import { logServerFailure } from '$lib/server/platform/logging';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Entrada anterior de la conciliación comercial (cron externo, ~cada 6 h). Ejecuta la
// misma conciliación presupuestada que el mantenimiento del programador nuevo y,
// cuando el paso de release apaga las entradas antiguas, responde 410 sin ejecutarla.
// La conciliación sincroniza suscripciones contra la API de MP y acredita cobros
// aprobados que webhook o retorno no hayan registrado (idempotente).
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
	const receipt = await runScheduledJob('commercial', fetch);
	return json(receipt, { status: receipt.ok ? 200 : 500 });
};

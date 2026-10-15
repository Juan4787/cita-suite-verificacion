import { loadPatientList } from '$lib/server/patient-list';
import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	event.setHeaders({
		'cache-control': 'private, no-store',
		vary: 'Cookie'
	});
	if (!event.locals.auth) {
		return json(
			{ message: 'Tu sesión terminó. Volvé a iniciar sesión.' },
			{ status: 401 }
		);
	}

	try {
		return json(await loadPatientList(event));
	} catch (error) {
		if (isHttpError(error)) {
			return json(
				{ message: String(error.body?.message ?? 'No se pudieron cargar los pacientes.') },
				{ status: error.status }
			);
		}
		throw error;
	}
};

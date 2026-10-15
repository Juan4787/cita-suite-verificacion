// Fallback de descarga del calendario (attachment) para navegadores que no abren
// bien text/calendar inline. Mismo contenido vivo que /calendario.ics.

import { error } from '@sveltejs/kit';
import { loadAppointmentForToken } from '$lib/server/appointment-token';
import { icsForAppointment } from '$lib/server/calendar-content';
import {
	canRegisterCalendarAction,
	recordCalendarAction
} from '$lib/server/calendar-tracking';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, fetch }) => {
	const { appointment, supabase, demo } = await loadAppointmentForToken(fetch, params.token);
	if (!appointment) throw error(404, 'El enlace no es válido o ya no está disponible.');

	if (!demo && supabase && canRegisterCalendarAction(appointment)) {
		try {
			await recordCalendarAction(supabase, appointment, 'downloaded_ics');
		} catch (trackingError) {
			console.error('Error registrando descarga de calendario', trackingError);
		}
	}

	const method = appointment.status === 'cancelled' ? 'CANCEL' : 'PUBLISH';
	return new Response(icsForAppointment(appointment), {
		headers: {
			'content-type': `text/calendar; charset=utf-8; method=${method}`,
			'content-disposition': 'attachment; filename="turno.ics"',
			'cache-control': 'no-store'
		}
	});
};

// Evento de calendario del turno, servido inline para que el navegador lo abra con
// el calendario (camino principal en iPhone/iPad). Siempre se genera desde el estado
// ACTUAL del turno: tras una reprogramación este mismo link entrega fecha nueva y
// SEQUENCE incrementado; si el turno se canceló entrega METHOD:CANCEL.

import { error } from '@sveltejs/kit';
import { loadAppointmentForToken } from '$lib/server/appointment-token';
import { icsForAppointment } from '$lib/server/calendar-content';
import {
	canRegisterCalendarAction,
	recordCalendarAction
} from '$lib/server/calendar-tracking';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, fetch }) => {
	const { appointment, supabase, demo } = await loadAppointmentForToken(fetch, params.token);
	if (!appointment) throw error(404, 'El enlace no es válido o ya no está disponible.');

	// ?p=phone distingue "Calendario del teléfono" de la opción .ics genérica.
	const action = url.searchParams.get('p') === 'phone' ? 'clicked_phone_calendar' : 'clicked_ics';
	if (!demo && supabase && canRegisterCalendarAction(appointment)) {
		try {
			await recordCalendarAction(supabase, appointment, action);
		} catch (trackingError) {
			// El tracking nunca bloquea la entrega del calendario.
			console.error('Error registrando acción de calendario', trackingError);
		}
	}

	const method = appointment.status === 'cancelled' ? 'CANCEL' : 'PUBLISH';
	return new Response(icsForAppointment(appointment), {
		headers: {
			'content-type': `text/calendar; charset=utf-8; method=${method}`,
			'content-disposition': 'inline; filename="turno.ics"',
			'cache-control': 'no-store'
		}
	});
};

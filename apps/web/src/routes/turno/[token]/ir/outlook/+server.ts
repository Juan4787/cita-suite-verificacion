// Redirect-through a Outlook (cuentas personales, opción de desktop).

import { loadAppointmentForToken, uncachedRedirect } from '$lib/server/appointment-token';
import { outlookUrlFor } from '$lib/server/calendar-content';
import {
	canRegisterCalendarAction,
	recordCalendarAction
} from '$lib/server/calendar-tracking';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, fetch }) => {
	const { appointment, supabase, demo } = await loadAppointmentForToken(fetch, params.token);
	if (!appointment || !canRegisterCalendarAction(appointment)) {
		return uncachedRedirect(`/turno/${params.token}`);
	}

	if (!demo && supabase) {
		try {
			await recordCalendarAction(supabase, appointment, 'clicked_outlook');
		} catch (trackingError) {
			console.error('Error registrando acción de calendario (outlook)', trackingError);
		}
	}

	return uncachedRedirect(outlookUrlFor(appointment));
};

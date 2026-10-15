// Redirect-through a Google Calendar: registra la acción server-side (funciona sin
// JS y en webviews) y recién después redirige al evento prellenado.

import { loadAppointmentForToken, uncachedRedirect } from '$lib/server/appointment-token';
import { googleCalendarUrlFor } from '$lib/server/calendar-content';
import {
	canRegisterCalendarAction,
	recordCalendarAction
} from '$lib/server/calendar-tracking';
import type { RequestHandler } from './$types';

// Orígenes conocidos del redirect (FASE 12): el fallback del intent nativo Android
// llega acá vía S.browser_fallback_url y queda diferenciado en el audit.
const KNOWN_SOURCES = new Set(['android_native_fallback']);

export const GET: RequestHandler = async ({ params, fetch, url }) => {
	const { appointment, supabase, demo } = await loadAppointmentForToken(fetch, params.token);
	if (!appointment || !canRegisterCalendarAction(appointment)) {
		// Turno inexistente, pasado o cerrado: la página del turno explica el estado.
		return uncachedRedirect(`/turno/${params.token}`);
	}

	if (!demo && supabase) {
		const sourceParam = url.searchParams.get('source') ?? '';
		const source = KNOWN_SOURCES.has(sourceParam) ? sourceParam : null;
		try {
			await recordCalendarAction(supabase, appointment, 'clicked_google', { source });
		} catch (trackingError) {
			console.error('Error registrando acción de calendario (google)', trackingError);
		}
	}

	return uncachedRedirect(googleCalendarUrlFor(appointment));
};

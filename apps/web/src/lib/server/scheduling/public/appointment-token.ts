// Carga del turno por token para los endpoints públicos de calendario/maps.
// En DEMO_MODE devuelve el turno de muestra sin tocar Supabase.

import { env } from '$env/dynamic/private';
import type { CitaSupabaseClient } from '$lib/types/database';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import {
	demoPublicAppointment,
	loadPublicAppointmentByToken,
	type PublicAppointmentView
} from '$lib/server/scheduling/public/public-appointments';

export type TokenAppointmentContext = {
	appointment: PublicAppointmentView | null;
	supabase: CitaSupabaseClient | null;
	demo: boolean;
};

export const loadAppointmentForToken = async (
	fetchFn: typeof fetch,
	token: string
): Promise<TokenAppointmentContext> => {
	if (env.DEMO_MODE === 'true') {
		return { appointment: demoPublicAppointment(token), supabase: null, demo: true };
	}
	const supabase = await createSupabaseAdminClient('odonto', fetchFn);
	const appointment = await loadPublicAppointmentByToken(supabase, token);
	return { appointment, supabase, demo: false };
};

// Redirect manual para poder fijar no-store: los redirects llevan el token en la URL
// y no deben quedar cacheados por CDN.
export const uncachedRedirect = (location: string) =>
	new Response(null, {
		status: 302,
		headers: { location, 'cache-control': 'no-store' }
	});

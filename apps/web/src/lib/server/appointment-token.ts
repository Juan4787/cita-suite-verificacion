// Carga del turno por token para los endpoints públicos de calendario/maps.
// En DEMO_MODE devuelve el turno de muestra sin tocar Supabase.

import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from './supabase';
import {
	demoPublicAppointment,
	loadPublicAppointmentByToken,
	type PublicAppointmentView
} from './public-appointments';

export type TokenAppointmentContext = {
	appointment: PublicAppointmentView | null;
	supabase: SupabaseClient | null;
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

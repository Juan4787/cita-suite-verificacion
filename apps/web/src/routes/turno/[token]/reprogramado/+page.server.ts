// Vista pública MINIMAL de reprogramación: muestra SOLO el aviso de que el turno
// cambió, el resumen del nuevo turno (servicio · profesional · nueva fecha y hora ·
// ubicación) y dos recordatorios (push / calendario). No expone acciones ni la página
// de gestión completa. Detrás del token → nunca cachear.

import { env } from '$env/dynamic/private';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { demoPublicAppointment, loadPublicAppointmentByToken } from '$lib/server/public-appointments';
import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });

	if (env.DEMO_MODE === 'true') {
		const appointment = demoPublicAppointment(params.token);
		return { appointment, active: true, demo: true };
	}

	try {
		const supabase = await createSupabaseAdminClient('odonto', fetch);
		const now = new Date();
		const appointment = await loadPublicAppointmentByToken(supabase, params.token, now);
		const active = Boolean(
			appointment && !appointment.is_past && isActiveAppointmentStatus(appointment.status)
		);
		return { appointment, active, demo: false };
	} catch (error) {
		console.error('Error cargando vista de reprogramación', error);
		return { appointment: null, active: false, demo: false };
	}
};

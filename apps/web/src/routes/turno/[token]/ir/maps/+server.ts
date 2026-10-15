// Redirect-through a Google Maps ("Cómo llegar"). No cambia el estado de calendario:
// solo deja constancia en el audit log como métrica de uso.

import { loadAppointmentForToken, uncachedRedirect } from '$lib/server/appointment-token';
import { writeAuditLog } from '$lib/server/audit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, fetch }) => {
	const { appointment, supabase, demo } = await loadAppointmentForToken(fetch, params.token);
	const mapsLink = appointment?.business.maps_link;
	if (!appointment || !mapsLink) {
		return uncachedRedirect(`/turno/${params.token}`);
	}

	if (!demo && supabase) {
		try {
			await writeAuditLog(supabase, {
				businessId: appointment.business.id,
				userId: null,
				action: 'appointment.maps_opened',
				entityType: 'appointment',
				entityId: appointment.id,
				metadata: { source: 'public_token' }
			});
		} catch (auditError) {
			console.error('Error registrando apertura de maps', auditError);
		}
	}

	return uncachedRedirect(mapsLink);
};

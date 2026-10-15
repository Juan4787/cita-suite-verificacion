import { resolveBookingIntegrationRequest } from '$lib/server/booking-integration-request';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	event.setHeaders({ 'referrer-policy': 'no-referrer' });
	const { embed } = await resolveBookingIntegrationRequest(event);
	return { embed };
};

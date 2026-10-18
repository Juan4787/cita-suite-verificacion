import { env } from '$env/dynamic/private';
import { fail } from '@sveltejs/kit';
import { resolveBookingIntegrationRequest } from '$lib/server/sites/public/booking-integration-request';
import { loadPublicBookingPage, submitPublicBookingPage } from '$lib/server/scheduling/public/public-booking-page';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
    const { integration } = await resolveBookingIntegrationRequest(event);
    if (!integration) return { state: { business: null, services: [], professionals: [], days: [], slots: [], issue: 'integration_unavailable' }, selected: { serviceId: '', professionalId: '', professionalIds: [], bookingMode: 'individual' as const, date: '' }, mapsLink: null, turnstileSiteKey: null, bookingRequestId: '', demo: false };
    return loadPublicBookingPage(event, integration);
};

export const actions: Actions = {
    create_booking: async (event) => {
		if (env.BOOKING_INTEGRATIONS_ENABLED !== 'true' || env.DEMO_MODE === 'true') return fail(503, { message: 'La reserva desde este sitio todavía no está habilitada.' });
        const { integration } = await resolveBookingIntegrationRequest(event);
        if (!integration) return fail(404, { message: 'La reserva desde este sitio no está disponible. Contactá al consultorio.' });
        return submitPublicBookingPage(event, integration);
    }
};

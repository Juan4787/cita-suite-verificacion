import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { loadPublicBookingPage, submitPublicBookingPage } from '$lib/server/public-booking-page';
import { getPublicBusinessBySlug } from '$lib/server/public-booking';
import { loadDefaultBookingIntegration } from '$lib/server/booking-integrations';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { bookingContextsAvailable } from '$lib/server/booking-integration-flags';
import { error, type RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

async function defaultIntegration(event: RequestEvent) {
    if (!bookingContextsAvailable() || env.DEMO_MODE === 'true') return undefined;
    try {
        const reference = event.params.businessSlug ?? '';
        const supabase = await createSupabaseAdminClient('odonto', event.fetch);
        const businessId = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(reference) ? reference : (await getPublicBusinessBySlug(supabase, reference))?.id;
        const integration = businessId ? (await loadDefaultBookingIntegration(supabase, businessId, dev)) ?? undefined : undefined;
        return integration && env.BOOKING_INTEGRATIONS_ENABLED !== 'true' ? { ...integration, isActive: false } : integration;
    } catch {
        error(503, 'No pudimos cargar las reservas. Esperá unos segundos y volvé a intentar o contactá al consultorio.');
    }
}

export const load: PageServerLoad = async (event) => {
    const integration = await defaultIntegration(event);
    const data = await loadPublicBookingPage(event, integration, 'public_page');
    if (integration && 'presentation' in data && data.presentation) data.presentation.theme = 'cita-suite';
    if (integration && !integration.isActive) data.state = { business: null, services: [], professionals: [], days: [], slots: [], issue: 'integration_unavailable' };
    return data;
};
export const actions: Actions = {
    create_booking: async (event) => submitPublicBookingPage(event, await defaultIntegration(event), 'public_page')
};

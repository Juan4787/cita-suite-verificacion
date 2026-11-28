import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { error, redirect } from '@sveltejs/kit';
import { resolveBookingIntegrationRequest } from '$lib/server/sites/public/booking-integration-request';
import { loadPatientManagementView } from '$lib/server/scheduling/public/patient-management';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
    const { params, setHeaders, url } = event;
    // The parent embed layout owns Referrer-Policy for every child route.
    // SvelteKit rejects duplicate headers across nested load functions.
    setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive' });
    if (!/^[a-f0-9]{64}$/.test(params.token)) error(404, 'No encontramos ese turno. Revisá el enlace que recibiste.');
    const { integration, embed } = await resolveBookingIntegrationRequest(event);
    const supabase = await createSupabaseAdminClient('odonto', event.fetch);
    if (!integration) error(404, 'Este enlace de reserva no está disponible.');
    const view = await loadPatientManagementView(supabase, { token: params.token, legacy: true });
    if (!view || view.integration?.id !== integration.id || view.appointment.business.id !== integration.businessId) error(404, 'No encontramos ese turno. Revisá el enlace que recibiste.');
    const appointment = view.appointment;
    if (!embed) {
        const query = new URLSearchParams();
        for (const key of ['creado', 'recuperado']) if (url.searchParams.get(key) === '1') query.set(key, '1');
        redirect(303, '/turno/' + params.token + (query.size ? '?' + query : ''));
    }
    const start = new URLSearchParams();
    for (const key of ['parent_origin', 'instance_id']) { const value = url.searchParams.get(key); if (value) start.set(key, value); }
    return {
        newBookingAllowed: view.newBookingAllowed,
        selfManagementCutoffHours: view.selfManagementCutoffHours,
        now: view.now,
        bookingStartUrl: '/embed/v1/' + integration.publicKey + '?' + start,
        recovered: url.searchParams.get('recuperado') === '1',
        appointment,
        theme: appointment.booking_context?.theme ?? integration.theme,
        publicKey: integration.publicKey
    };
};

import { error, redirect } from '@sveltejs/kit';
import { resolveBookingIntegrationRequest } from '$lib/server/booking-integration-request';
import { loadPublicAppointmentByToken } from '$lib/server/public-appointments';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
    const { params, setHeaders, url } = event;
    setHeaders({ 'cache-control': 'no-store' });
    if (!/^[a-f0-9]{64}$/.test(params.token)) error(404, 'No encontramos ese turno. Revisá el enlace que recibiste.');
    const { supabase, integration, embed } = await resolveBookingIntegrationRequest(event);
    if (!integration) error(404, 'Este enlace de reserva no está disponible.');
    const appointment = await loadPublicAppointmentByToken(supabase, params.token, new Date(), integration.id);
    if (!appointment) error(404, 'No encontramos ese turno. Revisá el enlace que recibiste.');
    if (!embed) {
        const query = new URLSearchParams();
        for (const key of ['creado', 'recuperado']) if (url.searchParams.get(key) === '1') query.set(key, '1');
        redirect(303, '/turno/' + params.token + (query.size ? '?' + query : ''));
    }
    const start = new URLSearchParams();
    for (const key of ['parent_origin', 'instance_id']) { const value = url.searchParams.get(key); if (value) start.set(key, value); }
    return { bookingStartUrl: '/embed/v1/' + integration.publicKey + '?' + start, recovered: url.searchParams.get('recuperado') === '1', appointment, theme: appointment.booking_context?.theme ?? integration.theme, publicKey: integration.publicKey };
};

import { logServerFailure } from '$lib/server/platform/logging';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { error, isHttpError, type RequestEvent } from '@sveltejs/kit';
import { BOOKING_INTEGRATION_KEY_PATTERN, normalizeBookingOrigin } from '@cita-suite/shared/booking-integration';
import { loadBookingIntegration, type BookingIntegration } from '$lib/server/sites/public/booking-integrations';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { hashRateLimitSubject } from '$lib/server/platform/rate-limits';

export type ResolvedBookingIntegration = {
	integration: BookingIntegration;
	embed: { parentOrigin: string; instanceId: string } | null;
};

/** Request-local reuse only; never cache configuration across requests or tenants. */
export async function resolveBookingIntegrationRequest(event: RequestEvent): Promise<ResolvedBookingIntegration> {
	if (env.BOOKING_INTEGRATIONS_ENABLED !== 'true' || env.DEMO_MODE === 'true') error(503, 'La reserva desde este sitio todavía no está habilitada.');
	const publicKey = event.params.integrationKey ?? '';
	if (!BOOKING_INTEGRATION_KEY_PATTERN.test(publicKey)) error(404, 'Este enlace de reserva no está disponible.');
	if (event.locals.bookingIntegrationRequest?.publicKey === publicKey) return event.locals.bookingIntegrationRequest.promise;
	const promise = readBookingIntegrationRequest(event, publicKey);
	event.locals.bookingIntegrationRequest = { publicKey, promise };
	return promise;
}

async function readBookingIntegrationRequest(event: RequestEvent, publicKey: string): Promise<ResolvedBookingIntegration> {
	try {
		const supabase = await createSupabaseAdminClient('odonto', event.fetch);
		const { data: allowed, error: rateError } = await supabase.rpc('consume_booking_integration_read_limit', {
			p_subject_hash: hashRateLimitSubject(event.getClientAddress())
		});
		if (rateError) {
			logServerFailure('booking.integration_limiter_unavailable', rateError);
			error(503, 'No pudimos cargar las reservas. Esperá unos segundos y volvé a intentar.');
		}
		if (allowed !== true) {
			event.setHeaders({ 'retry-after': '60' });
			error(429, 'Se consultaron muchas opciones en poco tiempo. Esperá un minuto antes de volver a intentar.');
		}
		const integration = await loadBookingIntegration(supabase, publicKey, dev);
		if (!integration) error(404, 'Este enlace de reserva no está disponible.');
		const rawParent = event.url.searchParams.get('parent_origin');
		const instanceId = event.url.searchParams.get('instance_id') ?? '';
		let embed: ResolvedBookingIntegration['embed'] = null;
		if (rawParent !== null || instanceId) {
			const parentOrigin = rawParent ? normalizeBookingOrigin(rawParent, dev) : null;
			if (!parentOrigin || !integration.allowedOrigins.includes(parentOrigin) || !/^[a-f0-9]{32}$/.test(instanceId)) error(403, 'Este sitio no está habilitado para mostrar la reserva.');
			embed = { parentOrigin, instanceId };
			event.locals.bookingFrameAncestors = integration.allowedOrigins;
		}
		// Only data is shared between sibling load functions. A client captures the
  // initiating load's event.fetch and must not escape into a later page load.
  return { integration, embed };
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		logServerFailure('booking.integration_unavailable', cause);
		error(503, 'No pudimos cargar las reservas. Esperá unos segundos y volvé a intentar o contactá al consultorio.');
	}
}

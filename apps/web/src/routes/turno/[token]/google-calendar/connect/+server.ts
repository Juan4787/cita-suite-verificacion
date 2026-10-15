import { createGoogleCalendarAuthorizationUrl } from '$lib/server/google-calendar';
import { loadAppointmentForToken } from '$lib/server/appointment-token';
import type { RequestHandler } from './$types';

const redirectBack = (token: string, status: string) =>
	new Response(null, {
		status: 303,
		headers: {
			location: `/turno/${token}?calendar=${encodeURIComponent(status)}`,
			'cache-control': 'no-store',
			'referrer-policy': 'no-referrer'
		}
	});

export const GET: RequestHandler = async ({ params, fetch, url }) => {
	const { appointment, supabase, demo } = await loadAppointmentForToken(fetch, params.token);
	if (demo || !appointment || !supabase || appointment.is_past) {
		return redirectBack(params.token, 'unavailable');
	}
	try {
		const authorizationUrl = await createGoogleCalendarAuthorizationUrl(supabase, appointment, {
			forceConsent: url.searchParams.get('reauthorize') === '1'
		});
		return new Response(null, {
			status: 303,
			headers: {
				location: authorizationUrl,
				'cache-control': 'no-store',
				'referrer-policy': 'no-referrer'
			}
		});
	} catch (error) {
		console.error('No se pudo iniciar Google Calendar', {
			appointmentId: appointment.id,
			code: error instanceof Error ? error.message : 'unknown'
		});
		return redirectBack(params.token, 'unavailable');
	}
};

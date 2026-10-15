import {
	authorizeGoogleCalendarAppointment,
	consumeGoogleCalendarOAuthAttempt,
	processGoogleCalendarEvent
} from '$lib/server/google-calendar';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

const redirectToAppointment = (token: string, status: string) =>
	new Response(null, {
		status: 303,
		headers: {
			location: `/turno/${token}?calendar=${encodeURIComponent(status)}`,
			'cache-control': 'no-store',
			'referrer-policy': 'no-referrer'
		}
	});

const loadToken = async (
	supabase: SupabaseClient,
	appointmentId: string
): Promise<string | null> => {
	const { data, error } = await supabase
		.from('appointments')
		.select('confirmation_token')
		.eq('id', appointmentId)
		.maybeSingle();
	if (error) throw error;
	return data?.confirmation_token ? String(data.confirmation_token) : null;
};

export const GET: RequestHandler = async ({ url, fetch }) => {
	const state = url.searchParams.get('state') ?? '';
	let appointmentId: string | null = null;
	let appointmentToken: string | null = null;
	try {
		const supabase = await createSupabaseAdminClient('odonto', fetch);
		const attempt = await consumeGoogleCalendarOAuthAttempt(supabase, state);
		appointmentId = attempt.appointmentId;
		appointmentToken = await loadToken(supabase, appointmentId);
		if (!appointmentToken) throw new Error('GOOGLE_CALENDAR_APPOINTMENT_NOT_FOUND');

		const providerError = url.searchParams.get('error');
		if (providerError) {
			return redirectToAppointment(
				appointmentToken,
				providerError === 'access_denied' ? 'cancelled' : 'unavailable'
			);
		}

		const code = url.searchParams.get('code') ?? '';
		const authorization = await authorizeGoogleCalendarAppointment(
			supabase,
			attempt,
			code,
			fetch
		);
		const sync = await processGoogleCalendarEvent(
			supabase,
			authorization.eventRowId,
			fetch,
			{ accessToken: authorization.accessToken }
		);
		const status =
			sync.status === 'active'
				? 'connected'
				: sync.status === 'needs_reconnect'
					? 'reconnect'
					: sync.status.startsWith('pending_')
						? 'preparing'
						: 'unavailable';
		return redirectToAppointment(appointmentToken, status);
	} catch (error: any) {
		const code = String(error?.message ?? error?.code ?? 'unknown');
		console.error('No se pudo completar Google Calendar', {
			appointmentId,
			code: code.slice(0, 120)
		});
		if (appointmentToken) {
			return redirectToAppointment(
				appointmentToken,
				code.includes('REAUTH_REQUIRED') ? 'reconnect' : 'unavailable'
			);
		}
		return new Response('Este enlace ya no está disponible.', {
			status: 400,
			headers: {
				'content-type': 'text/plain; charset=utf-8',
				'cache-control': 'no-store',
				'referrer-policy': 'no-referrer'
			}
		});
	}
};

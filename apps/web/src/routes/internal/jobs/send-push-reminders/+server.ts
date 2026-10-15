// Job de envío de recordatorios push (cron externo ~cada 10 min, igual que los jobs
// de dispatches). Idempotente: claim atómico en la RPC + sent_at tras envío exitoso.

import { assertInternalJobRequest } from '$lib/server/internal-jobs';
import { processGoogleCalendarSyncJobs } from '$lib/server/google-calendar';
import { sendDueGoogleReviewRequests } from '$lib/server/google-reviews';
import { sendDuePushReminders } from '$lib/server/push';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch, url }) => {
	const unauthorized = assertInternalJobRequest(request);
	if (unauthorized) return unauthorized;

	const supabase = await createSupabaseAdminClient('odonto', fetch);
	let push: Awaited<ReturnType<typeof sendDuePushReminders>> | null = null;
	let googleReviews: Awaited<ReturnType<typeof sendDueGoogleReviewRequests>> | null = null;
	let googleCalendar: Awaited<ReturnType<typeof processGoogleCalendarSyncJobs>> | null = null;
	let failed = false;

	try {
		push = await sendDuePushReminders(supabase, {
			limit: Number(url.searchParams.get('limit') ?? 50)
		});
	} catch (error) {
		failed = true;
		console.error('Error procesando recordatorios push', {
			code: error instanceof Error ? error.message.slice(0, 120) : 'unknown'
		});
	}

	// La cola de reseñas comparte la frecuencia del cron, pero no su resultado:
	// una integración con problemas nunca debe frenar recordatorios ni calendario.
	try {
		googleReviews = await sendDueGoogleReviewRequests(supabase, {
			limit: Number(url.searchParams.get('review_limit') ?? 20)
		});
	} catch (error) {
		failed = true;
		console.error('Error procesando solicitudes de reseña', {
			code: error instanceof Error ? error.message.slice(0, 120) : 'unknown'
		});
	}

	// Aprovecha el job ya programado cada ~10 minutos. Se ejecuta aun si el
	// pipeline push tuvo un problema, y viceversa: son coberturas independientes.
	try {
		googleCalendar = await processGoogleCalendarSyncJobs(supabase, fetch, {
			limit: Number(url.searchParams.get('calendar_limit') ?? 20)
		});
	} catch (error) {
		failed = true;
		console.error('Error procesando sincronizaciones Google Calendar', {
			code: error instanceof Error ? error.message.slice(0, 120) : 'unknown'
		});
	}

	return json(
		{ ok: !failed, push, googleReviews, googleCalendar },
		{ status: failed ? 500 : 200 }
	);
};

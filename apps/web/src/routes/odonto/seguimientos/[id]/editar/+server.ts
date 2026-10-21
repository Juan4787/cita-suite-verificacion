import { logServerFailure } from '$lib/server/platform/logging';
import { readRecord } from '$lib/contracts/json';
import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import {
	FollowUpError,
	getFollowUpErrorMessage,
	getFollowUpErrorStatus,
	roleParticipatesInFollowUps,
	updateFollowUp
} from '$lib/server/patients/public/follow-ups';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true')
		return json({ message: 'No disponible en modo demo.' }, { status: 400 });

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!roleParticipatesInFollowUps(business.role))
		return json({ message: 'No tenés permiso para esta acción.' }, { status: 403 });
	if (!business.access.canUseBusiness)
		return json(
			{ message: 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a operar.' },
			{ status: 403 }
		);

	let body: Record<string, unknown>;
	try {
		body = readRecord(await request.json(), 'followUp.request');
	} catch {
		return json({ message: 'Solicitud inválida.' }, { status: 400 });
	}

	try {
		await updateFollowUp(supabase, {
			businessId: business.business.id,
			id: params.id,
			remindOn: String(body.remind_on ?? '').trim(),
			message: typeof body.message === 'string' ? body.message : null,
			assignToProfessionalId: body.assigned_professional_id
				? String(body.assigned_professional_id).trim()
				: null,
			expectedUpdatedAt:
				typeof body.expected_updated_at === 'string' ? body.expected_updated_at.trim() : null
		});
		return json({ ok: true });
	} catch (err) {
		if (err instanceof FollowUpError)
			return json({ message: getFollowUpErrorMessage(err.code) }, { status: getFollowUpErrorStatus(err.code) });
		logServerFailure('Error editando seguimiento', err);
		return json({ message: 'No se pudo editar el seguimiento.' }, { status: 500 });
	}
};

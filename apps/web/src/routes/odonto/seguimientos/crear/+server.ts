import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	buildFollowUpScope,
	createFollowUp,
	FollowUpError,
	getFollowUpErrorMessage,
	getFollowUpErrorStatus,
	roleParticipatesInFollowUps
} from '$lib/server/follow-ups';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true')
		return json({ message: 'No disponible en modo demo.' }, { status: 400 });

	const { business, userId } = await getOdontoContext({ locals, fetch, cookies });
	if (!roleParticipatesInFollowUps(business.role))
		return json({ message: 'No tenés permiso para crear seguimientos.' }, { status: 403 });
	if (!business.access.canUseBusiness)
		return json(
			{ message: 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a operar.' },
			{ status: 403 }
		);

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ message: 'Solicitud inválida.' }, { status: 400 });
	}

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const scope = await buildFollowUpScope(admin, business, userId);

	try {
		const id = await createFollowUp(admin, {
			businessId: scope.businessId,
			role: scope.role,
			userId,
			actingProfessionalId: scope.professionalId,
			patientId: String(body.patient_id ?? '').trim(),
			remindOn: String(body.remind_on ?? '').trim(),
			message: typeof body.message === 'string' ? body.message : null,
			assignToProfessionalId: body.assigned_professional_id
				? String(body.assigned_professional_id).trim()
				: null,
			timezone: scope.timezone
		});
		return json({ ok: true, id });
	} catch (err) {
		if (err instanceof FollowUpError)
			return json({ message: getFollowUpErrorMessage(err.code) }, { status: getFollowUpErrorStatus(err.code) });
		console.error('Error creando seguimiento', err);
		return json({ message: 'No se pudo crear el seguimiento. Intentá de nuevo.' }, { status: 500 });
	}
};

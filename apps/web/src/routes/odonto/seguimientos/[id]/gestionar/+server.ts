import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	buildFollowUpScope,
	FollowUpError,
	getFollowUpErrorMessage,
	getFollowUpErrorStatus,
	markFollowUpDone,
	roleParticipatesInFollowUps
} from '$lib/server/follow-ups';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// "Ya lo gestioné" → termina el seguimiento.
export const POST: RequestHandler = async ({ params, request, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true')
		return json({ message: 'No disponible en modo demo.' }, { status: 400 });

	const { business, userId } = await getOdontoContext({ locals, fetch, cookies });
	if (!roleParticipatesInFollowUps(business.role))
		return json({ message: 'No tenés permiso para esta acción.' }, { status: 403 });
	if (!business.access.canUseBusiness)
		return json(
			{ message: 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a operar.' },
			{ status: 403 }
		);

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const scope = await buildFollowUpScope(admin, business, userId);
	let body: Record<string, unknown> = {};
	try {
		const raw = await request.text();
		if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return json({ message: 'Solicitud inválida.' }, { status: 400 });
	}

	try {
		await markFollowUpDone(admin, {
			businessId: scope.businessId,
			role: scope.role,
			professionalId: scope.professionalId,
			id: params.id,
			expectedUpdatedAt:
				typeof body.expected_updated_at === 'string' ? body.expected_updated_at.trim() : null
		});
		return json({ ok: true });
	} catch (err) {
		if (err instanceof FollowUpError)
			return json({ message: getFollowUpErrorMessage(err.code) }, { status: getFollowUpErrorStatus(err.code) });
		console.error('Error gestionando seguimiento', err);
		return json({ message: 'No se pudo gestionar el seguimiento.' }, { status: 500 });
	}
};

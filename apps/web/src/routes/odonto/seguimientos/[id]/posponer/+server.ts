import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	buildFollowUpScope,
	businessTodayISO,
	FollowUpError,
	getFollowUpErrorMessage,
	getFollowUpErrorStatus,
	roleParticipatesInFollowUps,
	snoozeFollowUp,
	snoozePresetDate,
	type SnoozePreset
} from '$lib/server/follow-ups';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const PRESETS: SnoozePreset[] = ['manana', 'tres_dias', 'semana'];

// "Recordar más tarde" → mueve la fecha a futuro (sale de "ejecutándose").
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

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ message: 'Solicitud inválida.' }, { status: 400 });
	}

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const scope = await buildFollowUpScope(admin, business, userId);

	let newRemindOn = '';
	const preset = String(body.preset ?? '') as SnoozePreset;
	if (PRESETS.includes(preset)) {
		newRemindOn = snoozePresetDate(preset, businessTodayISO(scope.timezone));
	} else if (typeof body.date === 'string') {
		newRemindOn = body.date.trim();
	} else {
		return json({ message: 'Elegí una fecha para posponer el recordatorio.' }, { status: 400 });
	}

	try {
		await snoozeFollowUp(admin, {
			businessId: scope.businessId,
			role: scope.role,
			professionalId: scope.professionalId,
			id: params.id,
			newRemindOn,
			timezone: scope.timezone,
			expectedUpdatedAt:
				typeof body.expected_updated_at === 'string' ? body.expected_updated_at.trim() : null
		});
		return json({ ok: true });
	} catch (err) {
		if (err instanceof FollowUpError)
			return json({ message: getFollowUpErrorMessage(err.code) }, { status: getFollowUpErrorStatus(err.code) });
		console.error('Error posponiendo seguimiento', err);
		return json({ message: 'No se pudo posponer el seguimiento.' }, { status: 500 });
	}
};

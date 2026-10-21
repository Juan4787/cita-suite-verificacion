import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import {
	FollowUpError,
	getFollowUpErrorMessage,
	getFollowUpErrorStatus,
	listAssignableProfessionalsForPatient,
	roleSeesAllFollowUps
} from '$lib/server/patients/public/follow-ups';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Sólo Dueño/Admin/Recepción asignan a un profesional. El profesional queda auto-asignado.
export const GET: RequestHandler = async ({ url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ professionals: [] });

	const { supabase, business } = await getOdontoContext({
		locals,
		fetch,
		cookies,
		membershipCache: 'fresh'
	});
	if (!roleSeesAllFollowUps(business.role)) return json({ professionals: [] });

	const patientId = (url.searchParams.get('patient_id') ?? '').trim();
	if (!patientId) return json({ professionals: [] });

	try {
		const professionals = await listAssignableProfessionalsForPatient(supabase, business.business.id, patientId);
		return json({ professionals });
	} catch (err) {
		if (err instanceof FollowUpError)
			return json({ message: getFollowUpErrorMessage(err.code) }, { status: getFollowUpErrorStatus(err.code) });
		logServerFailure('Error listando profesionales del paciente', err);
		return json({ message: 'No se pudo cargar la lista de profesionales.' }, { status: 500 });
	}
};

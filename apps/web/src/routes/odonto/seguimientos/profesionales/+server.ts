import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { listAssignableProfessionalsForPatient, roleSeesAllFollowUps } from '$lib/server/follow-ups';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Sólo Dueño/Admin/Recepción asignan a un profesional. El profesional queda auto-asignado.
export const GET: RequestHandler = async ({ url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ professionals: [] });

	const { business } = await getOdontoContext({
		locals,
		fetch,
		cookies,
		membershipCache: 'fresh'
	});
	if (!roleSeesAllFollowUps(business.role)) return json({ professionals: [] });

	const patientId = (url.searchParams.get('patient_id') ?? '').trim();
	if (!patientId) return json({ professionals: [] });

	const admin = await createSupabaseAdminClient('odonto', fetch);
	try {
		const professionals = await listAssignableProfessionalsForPatient(admin, business.business.id, patientId);
		return json({ professionals });
	} catch (err) {
		console.error('Error listando profesionales del paciente', err);
		return json({ message: 'No se pudo cargar la lista de profesionales.' }, { status: 500 });
	}
};

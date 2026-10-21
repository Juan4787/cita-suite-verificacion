import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { listAssignablePatientsSearch, roleParticipatesInFollowUps } from '$lib/server/patients/public/follow-ups';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ patients: [] });

	const { supabase, business } = await getOdontoContext({
		locals,
		fetch,
		cookies,
		membershipCache: 'fresh'
	});
	if (!roleParticipatesInFollowUps(business.role)) return json({ patients: [] });

	try {
		// The database shows each role the patients it may read: a professional, their own.
		const patients = await listAssignablePatientsSearch(supabase, business.business.id, url.searchParams.get('q') ?? '');
		return json({ patients });
	} catch (err) {
		logServerFailure('Error buscando pacientes para seguimiento', err);
		return json({ message: 'No pudimos buscar pacientes para el seguimiento. Revisá tu conexión y volvé a intentar.' }, { status: 500 });
	}
};

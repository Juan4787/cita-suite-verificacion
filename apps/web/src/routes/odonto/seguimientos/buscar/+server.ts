import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	buildFollowUpScope,
	listAssignablePatientsSearch,
	roleParticipatesInFollowUps
} from '$lib/server/follow-ups';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ patients: [] });

	const { business, userId } = await getOdontoContext({
		locals,
		fetch,
		cookies,
		membershipCache: 'fresh'
	});
	if (!roleParticipatesInFollowUps(business.role)) return json({ patients: [] });

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const scope = await buildFollowUpScope(admin, business, userId);
	try {
		const patients = await listAssignablePatientsSearch(admin, scope, url.searchParams.get('q') ?? '');
		return json({ patients });
	} catch (err) {
		console.error('Error buscando pacientes para seguimiento', err);
		return json({ message: 'No pudimos buscar pacientes para el seguimiento. Revisá tu conexión y volvé a intentar.' }, { status: 500 });
	}
};

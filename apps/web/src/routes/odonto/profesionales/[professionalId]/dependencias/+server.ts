import { getProfessionalDependencies } from '$lib/server/team/public/professional-lifecycle';
import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, fetch, cookies, setHeaders }) => {
	if (!locals.auth) throw redirect(303, '/login');
	setHeaders({ 'cache-control': 'private, no-store' });
	if (env.DEMO_MODE === 'true') {
		return json({ appointment_count: 0, clinical_entry_count: 0, follow_up_count: 0 });
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canManage) {
		return json({ message: 'No tenés permisos para revisar este profesional.' }, { status: 403 });
	}
	const result = await getProfessionalDependencies(
		supabase,
		business.business.id,
		params.professionalId
	);
	if (!result.ok) return json({ message: result.message }, { status: result.status });
	return json(result.data);
};

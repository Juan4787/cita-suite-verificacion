import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { readPatientChanges } from '$lib/server/patients/public/patient-changes';
import { PatientOperationError } from '$lib/server/patients/public/patient-operation-error';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, fetch, cookies, setHeaders }) => {
	if (!locals.auth) throw redirect(303, '/login');
	setHeaders({ 'cache-control': 'private, no-store' });
	if (env.DEMO_MODE === 'true') return json({ change_events: [] });

	const { supabase, business } = await getOdontoContext({
		locals,
		fetch,
		cookies,
		membershipCache: 'fresh'
	});
	try {
		return json(await readPatientChanges({ supabase, context: business, patientId: params.id }));
	} catch (cause) {
		if (cause instanceof PatientOperationError)
			return json({ message: cause.message }, { status: cause.kind === 'missing' ? 404 : 500 });
		throw cause;
	}
};

import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
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
	// El cliente de usuario conserva RLS como primera barrera antes de usar el
	// cliente administrativo para leer el registro de auditoría.
	const { data: visiblePatient, error: patientError } = await supabase
		.from('patients')
		.select('id')
		.eq('business_id', business.business.id)
		.eq('id', params.id)
		.maybeSingle();
	if (patientError || !visiblePatient) {
		return json({ message: 'Paciente no encontrado o sin permiso.' }, { status: 404 });
	}
	const admin = await createSupabaseAdminClient('odonto', fetch);
	const { data, error } = await admin
		.from('patient_profile_change_events')
		.select('id, summary, changed_by_name, changed_fields, created_at')
		.eq('business_id', business.business.id)
		.eq('patient_id', params.id)
		.order('created_at', { ascending: false })
		.limit(5);

	if (error) {
		console.error('Error cargando cambios del paciente', error);
		return json({ message: 'No se pudieron cargar los últimos cambios.' }, { status: 500 });
	}
	return json({ change_events: data ?? [] });
};

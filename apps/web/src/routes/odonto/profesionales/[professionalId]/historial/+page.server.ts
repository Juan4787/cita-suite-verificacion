import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return { professional: null, appointments: [], entries: [], loadError: null, demo: true };
	}

	const { business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canManage) throw redirect(303, '/odonto/profesionales');

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const businessId = business.business.id;

	const { data: professional } = await admin
		.from('professionals')
		.select('id, name')
		.eq('business_id', businessId)
		.eq('id', params.professionalId)
		.maybeSingle();

	const [appointmentsResult, entriesResult] = await Promise.all([
		admin
			.from('appointments')
			.select(
				'id, starts_at, status, service_name_snapshot, patient_id, patients(full_name), appointment_professionals!inner(professional_id)'
			)
			.eq('business_id', businessId)
			.eq('appointment_professionals.professional_id', params.professionalId)
			.order('starts_at', { ascending: false })
			.limit(300),
		admin
			.from('clinical_entries')
			.select('id, created_at, entry_type, description, patient_id, patients(full_name)')
			.eq('business_id', businessId)
			.eq('created_by_professional_id', params.professionalId)
			.order('created_at', { ascending: false })
			.limit(300)
	]);

	const loadError = appointmentsResult.error?.message ?? entriesResult.error?.message ?? null;

	return {
		professional: professional ?? null,
		appointments: appointmentsResult.data ?? [],
		entries: entriesResult.data ?? [],
		loadError: loadError ? `No se pudo cargar parte del historial: ${loadError}` : null,
		demo: false
	};
};

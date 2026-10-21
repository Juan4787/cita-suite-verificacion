import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The latest records of each kind; the totals say how many there are in all.
const LIMIT = 300;

export const load: PageServerLoad = async ({ params, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return { professional: null, appointments: [], entries: [], appointmentsTotal: 0, entriesTotal: 0, demo: true };
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canManage) throw redirect(303, '/odonto/profesionales');
	const businessId = business.business.id;

	// The user's own client: the history follows the same read rules as the rest of the app.
	const [professionalResult, appointmentsResult, entriesResult] = await Promise.all([
		supabase.from('professionals').select('id, name').eq('business_id', businessId).eq('id', params.professionalId).maybeSingle(),
		supabase
			.from('appointments')
			.select(
				'id, starts_at, status, service_name_snapshot, patient_id, patients(full_name), appointment_professionals!inner(professional_id)',
				{ count: 'exact' }
			)
			.eq('business_id', businessId)
			.eq('appointment_professionals.professional_id', params.professionalId)
			.order('starts_at', { ascending: false })
			.limit(LIMIT),
		supabase
			.from('clinical_entries')
			.select('id, created_at, entry_type, description, patient_id, patients(full_name)', { count: 'exact' })
			.eq('business_id', businessId)
			.eq('created_by_professional_id', params.professionalId)
			.order('created_at', { ascending: false })
			.limit(LIMIT)
	]);
	// The page lists what must be resolved before removing the professional: part of it
	// is not an answer.
	const failure = professionalResult.error ?? appointmentsResult.error ?? entriesResult.error;
	if (failure) {
		logServerFailure('professional.history_unavailable', failure);
		error(503, 'No pudimos cargar el historial del profesional. Volvé a intentar.');
	}
	if (!professionalResult.data) error(404, 'No encontramos ese profesional.');

	return {
		professional: professionalResult.data,
		appointments: appointmentsResult.data ?? [],
		entries: entriesResult.data ?? [],
		appointmentsTotal: appointmentsResult.count ?? appointmentsResult.data?.length ?? 0,
		entriesTotal: entriesResult.count ?? entriesResult.data?.length ?? 0,
		demo: false
	};
};

import { env } from '$env/dynamic/private';
import { professionalHasFollowUps } from '$lib/server/follow-ups';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, fetch, cookies, setHeaders }) => {
	if (!locals.auth) throw redirect(303, '/login');
	setHeaders({ 'cache-control': 'private, no-store' });
	if (env.DEMO_MODE === 'true') {
		return json({ appointment_count: 0, clinical_entry_count: 0, follow_up_count: 0 });
	}

	const { business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canManage) {
		return json({ message: 'No tenés permisos para revisar este profesional.' }, { status: 403 });
	}
	const admin = await createSupabaseAdminClient('odonto', fetch);
	const businessId = business.business.id;
	const professionalId = params.professionalId;
	const [appointments, entries, followUpCount] = await Promise.all([
		admin
			.from('appointment_professionals')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', businessId)
			.eq('professional_id', professionalId),
		admin
			.from('clinical_entries')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', businessId)
			.eq('created_by_professional_id', professionalId),
		professionalHasFollowUps(admin, businessId, professionalId)
	]);
	if (appointments.error || entries.error) {
		console.error('Error cargando dependencias del profesional', appointments.error ?? entries.error);
		return json({ message: 'No se pudo comprobar el historial del profesional.' }, { status: 500 });
	}
	return json({
		appointment_count: appointments.count ?? 0,
		clinical_entry_count: entries.count ?? 0,
		follow_up_count: followUpCount
	});
};

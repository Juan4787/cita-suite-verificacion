import { env } from '$env/dynamic/private';
import {
	defaultInternalAvailabilitySnapshotRange,
	loadInternalAvailabilitySnapshot
} from '$lib/server/availability-snapshot';
import { getOdontoContext } from '$lib/server/odonto-context';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, fetch, cookies, setHeaders }) => {
	if (!locals.auth) throw redirect(303, '/login');
	setHeaders({ 'cache-control': 'private, no-store' });
	const scope = url.searchParams.get('scope') ?? 'core';
	if (env.DEMO_MODE === 'true') {
		return scope === 'patients'
			? json({ patients: [] })
			: json({
				professionals: [],
				services: [],
				patients: [],
				patients_loaded: false,
				service_professional_ids: {},
				availability_snapshot: null
			});
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (business.role === 'professional') {
		return json({ message: 'No tenés permisos para administrar la agenda.' }, { status: 403 });
	}
	const businessId = business.business.id;

	// La lista reciente de pacientes puede ser grande y no hace falta para elegir
	// procedimiento o profesional. Se pide recién al abrir "Buscar paciente".
	if (scope === 'patients') {
		const { data: patients, error } = await supabase
			.from('patients')
			.select('id, full_name, phone, phone_raw, phone_e164, dni, birth_date, activity_at, blocked')
			.eq('business_id', businessId)
			.is('archived_at', null)
			.order('updated_at', { ascending: false })
			.limit(250);
		if (error) {
			console.error('Error cargando pacientes de agenda', error);
			return json({ message: 'No se pudieron cargar los pacientes.' }, { status: 500 });
		}
		return json({ patients: patients ?? [] });
	}

	let snapshot;
	try {
		const range = defaultInternalAvailabilitySnapshotRange(
			business.business,
			url.searchParams.get('from') ?? undefined
		);
		snapshot = await loadInternalAvailabilitySnapshot(supabase, {
			business: business.business,
			...range
		});
	} catch (error) {
		console.error('Error cargando snapshot interno de agenda', error);
		return json({ message: 'No se pudieron cargar profesionales y servicios.' }, { status: 500 });
	}
	const serviceProfessionalIds = snapshot.assignments.reduce<Record<string, string[]>>(
		(acc, assignment: any) => {
			const serviceId = String(assignment.service_id);
			acc[serviceId] = acc[serviceId] ?? [];
			acc[serviceId].push(String(assignment.professional_id));
			return acc;
		},
		{}
	);
	return json({
		professionals: snapshot.professionals,
		services: snapshot.services,
		patients: [],
		patients_loaded: false,
		service_professional_ids: serviceProfessionalIds,
		availability_snapshot: snapshot
	});
};

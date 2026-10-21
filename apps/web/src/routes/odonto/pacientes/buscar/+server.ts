import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { normalizeSearchText } from '$lib/utils/agenda-search';
import { ilikeContains } from '$lib/server/platform/postgrest-filters';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const cleanQuery = (value: string) => value.trim().replace(/\s+/g, ' ');

export const GET: RequestHandler = async ({ url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ patients: [] });

	const query = cleanQuery(url.searchParams.get('q') ?? '');
	if (query.length < 1) return json({ patients: [] });

	const { supabase, business } = await getOdontoContext({
		locals,
		fetch,
		cookies,
		membershipCache: 'fresh'
	});
	const normalizedQuery = normalizeSearchText(query);
	const digits = query.replace(/\D/g, '');
	const filters = [
		ilikeContains('full_name', query),
		ilikeContains('phone_e164', query),
		ilikeContains('dni', query)
	];
	if (normalizedQuery) filters.push(ilikeContains('search_name_normalized', normalizedQuery));
	if (digits.length >= 2) {
		filters.push(ilikeContains('search_phone_digits', digits), ilikeContains('search_dni_digits', digits));
	}

	const { data, error } = await supabase
		.from('patients')
		.select('id, full_name, phone, phone_raw, phone_e164, dni, birth_date, activity_at, blocked')
		.eq('business_id', business.business.id)
		.is('archived_at', null)
		.or(filters.join(','))
		.order('updated_at', { ascending: false })
		.limit(12);

	if (error) {
		logServerFailure('Error buscando pacientes', error);
		return json({ message: 'No pudimos buscar pacientes ahora. Revisá tu conexión y volvé a intentar.' }, { status: 500 });
	}

	return json({ patients: data ?? [] });
};

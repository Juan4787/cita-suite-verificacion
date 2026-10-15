import { env } from '$env/dynamic/private';
import { ACTIVE_BUSINESS_COOKIE } from '$lib/server/business';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { splitActiveAppointmentGroups } from '$lib/utils/appointment-visibility';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESULTS = 60;

const empty = () => json({ upcoming: [], past: [] });

export const GET: RequestHandler = async ({ url, locals, fetch, cookies, setHeaders }) => {
	if (!locals.auth) throw redirect(303, '/login');
	setHeaders({ 'cache-control': 'private, no-store' });
	if (env.DEMO_MODE === 'true') return empty();

	const query = String(url.searchParams.get('q') ?? '').trim();
	if (!query) return empty();

	const cookieBusinessId = String(cookies.get(ACTIVE_BUSINESS_COOKIE) ?? '').trim();
	let businessId = cookieBusinessId;
	let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;

	if (UUID_PATTERN.test(cookieBusinessId)) {
		supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	} else {
		const context = await getOdontoContext({
			locals,
			fetch,
			cookies,
			membershipCache: 'fresh'
		});
		businessId = context.business.business.id;
		supabase = context.supabase;
	}

	const { data, error } = await supabase.rpc('search_upcoming_active_appointments', {
		p_business_id: businessId,
		p_query: query,
		p_limit: MAX_RESULTS
	});

	if (error) {
		const diagnostic = `${error.message ?? ''} ${error.code ?? ''}`;
		if (diagnostic.includes('AGENDA_SEARCH_DENIED')) {
			return json({ message: 'No tenés permisos para buscar en la agenda.' }, { status: 403 });
		}
		console.error('Error buscando turnos en la agenda', error);
		return json({ message: 'No pudimos buscar turnos ahora. Revisá tu conexión y volvé a intentar.' }, { status: 500 });
	}

	return json(splitActiveAppointmentGroups(Array.isArray(data) ? data : []));
};

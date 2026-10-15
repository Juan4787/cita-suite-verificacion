import { env } from '$env/dynamic/private';
import { ACTIVE_BUSINESS_COOKIE } from '$lib/server/business';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SNAPSHOT_RESULTS = 400;

const empty = () => json({ appointments: [] });

export const GET: RequestHandler = async ({ locals, fetch, cookies, setHeaders }) => {
	if (!locals.auth) throw redirect(303, '/login');
	setHeaders({ 'cache-control': 'private, no-store' });
	if (env.DEMO_MODE === 'true') return empty();

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

	const { data, error } = await supabase.rpc('list_upcoming_active_appointments_snapshot', {
		p_business_id: businessId,
		p_limit: MAX_SNAPSHOT_RESULTS
	});

	if (error) {
		const diagnostic = `${error.message ?? ''} ${error.code ?? ''}`;
		if (diagnostic.includes('AGENDA_SEARCH_DENIED')) {
			return json({ message: 'No tenés permisos para buscar en la agenda.' }, { status: 403 });
		}
		console.error('Error preparando la búsqueda de turnos en la agenda', error);
		return json({ message: 'No pudimos preparar la búsqueda de turnos. Recargá la agenda y volvé a intentar.' }, { status: 500 });
	}

	return json({ appointments: Array.isArray(data) ? data : [] });
};

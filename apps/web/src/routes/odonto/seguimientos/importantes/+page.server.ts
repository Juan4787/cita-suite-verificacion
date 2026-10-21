import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import {
	businessTodayISO,
	listExecutingFollowUps,
	roleParticipatesInFollowUps,
	roleSeesAllFollowUps
} from '$lib/server/patients/public/follow-ups';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies, depends }) => {
	depends('app:follow-ups');
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			executing: [],
			executingTotal: 0,
			canAssign: false,
			todayISO: businessTodayISO('America/Argentina/Cordoba'),
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!roleParticipatesInFollowUps(business.role)) throw redirect(303, '/odonto/agenda');

	// The database shows each role what it may read, before the list's limit.
	const list = await listExecutingFollowUps(supabase, { businessId: business.business.id, timezone: business.business.timezone });

	return {
		executing: list.items,
		executingTotal: list.total,
		canAssign: roleSeesAllFollowUps(business.role),
		todayISO: businessTodayISO(business.business.timezone),
		demo: false
	};
};

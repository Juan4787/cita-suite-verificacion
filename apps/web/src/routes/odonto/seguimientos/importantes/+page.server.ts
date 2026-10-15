import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	buildFollowUpScope,
	businessTodayISO,
	listExecutingFollowUps,
	roleParticipatesInFollowUps,
	roleSeesAllFollowUps
} from '$lib/server/follow-ups';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies, depends }) => {
	depends('app:follow-ups');
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			executing: [],
			canAssign: false,
			todayISO: businessTodayISO('America/Argentina/Cordoba'),
			demo: true
		};
	}

	const { business, userId } = await getOdontoContext({ locals, fetch, cookies });
	if (!roleParticipatesInFollowUps(business.role)) throw redirect(303, '/odonto/agenda');

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const scope = await buildFollowUpScope(admin, business, userId);
	const executing = await listExecutingFollowUps(admin, scope);

	return {
		executing,
		canAssign: roleSeesAllFollowUps(business.role),
		todayISO: businessTodayISO(business.business.timezone),
		demo: false
	};
};

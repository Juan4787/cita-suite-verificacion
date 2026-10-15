import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	buildFollowUpScope,
	businessTodayISO,
	listProgrammedFollowUps,
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
			programmed: [],
			canAssign: false,
			todayISO: businessTodayISO('America/Argentina/Cordoba'),
			demo: true
		};
	}

	const { business, userId } = await getOdontoContext({
		locals,
		fetch,
		cookies,
		membershipCache: 'fresh'
	});
	// Lectura no participa de Seguimientos.
	if (!roleParticipatesInFollowUps(business.role)) throw redirect(303, '/odonto/agenda');

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const scope = await buildFollowUpScope(admin, business, userId);
	const programmed = await listProgrammedFollowUps(admin, scope);

	return {
		programmed,
		canAssign: roleSeesAllFollowUps(business.role),
		todayISO: businessTodayISO(business.business.timezone),
		demo: false
	};
};

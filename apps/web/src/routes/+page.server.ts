import { getModuleEntryRoute } from '$lib/server/platform/supabase';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.auth) {
		throw redirect(302, getModuleEntryRoute(locals.auth.module));
	}

	throw redirect(302, '/login');
};

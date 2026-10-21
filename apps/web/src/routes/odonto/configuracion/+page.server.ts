import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/access/public/business';
import { createSupabaseServerClient, isMasterEmail } from '$lib/server/platform/supabase';
import { verifiedRequestEmail } from '$lib/server/access/public/odonto-context';
import { redirect } from '@sveltejs/kit';
import { canExportPatientData } from '$lib/server/patients/public/patient-permissions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	const isMaster = isMasterEmail(verifiedRequestEmail(locals));
	if (env.DEMO_MODE === 'true') return { demo: true, isMaster, canExportPatientData: false };

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});

	if (context?.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context && context.role !== 'owner' && context.role !== 'admin') {
		throw redirect(303, '/odonto/agenda');
	}

	return {
		demo: false,
		isMaster,
		canExportPatientData: context ? canExportPatientData(context) : false
	};
};

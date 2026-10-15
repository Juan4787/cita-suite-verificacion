import { env } from '$env/dynamic/private';
import {
	clinicalFileError,
	getClinicalFileRequestContext,
	requireClinicalFileTrashView
} from '$lib/server/clinical-files';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return { demo: true, canRestore: false };

	try {
		const context = await getClinicalFileRequestContext(event);
		requireClinicalFileTrashView(context);
		return { demo: false, canRestore: context.canTrash };
	} catch (cause) {
		const safe = clinicalFileError(cause);
		throw error(safe.status, safe.userMessage);
	}
};

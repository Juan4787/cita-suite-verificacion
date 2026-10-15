import {
	clinicalFileCacheHeaders,
	clinicalFileErrorBody,
	clinicalFileError,
	getClinicalFileRequestContext,
	requireClinicalFileTrash
} from '$lib/server/clinical-files';
import { enforceRateLimits, radiographTrashRateLimitRules } from '$lib/server/rate-limits';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	event.setHeaders(clinicalFileCacheHeaders);
	try {
		const context = await getClinicalFileRequestContext(event);
		requireClinicalFileTrash(context);
		await enforceRateLimits(radiographTrashRateLimitRules(context.userId), event.fetch);
		const { error } = await context.admin.rpc('trash_patient_radiograph' as never, {
			p_actor_id: context.userId,
			p_business_id: context.businessId,
			p_patient_id: event.params.id,
			p_radiograph_id: event.params.radiographId
		} as never);
		if (error) throw error;
		return json({ id: event.params.radiographId, trashed: true });
	} catch (error) {
		console.error('Error moviendo imagen clínica a la papelera', error);
		const safe = clinicalFileError(error, 'No pudimos mover la imagen a la papelera.');
		const headers = safe.retryAfterSeconds ? { 'retry-after': String(safe.retryAfterSeconds) } : undefined;
		return json(clinicalFileErrorBody(safe), { status: safe.status, headers });
	}
};

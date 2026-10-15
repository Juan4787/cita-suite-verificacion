import {
	clinicalFileCacheHeaders,
	clinicalFileErrorBody,
	clinicalFileError,
	getClinicalFileRequestContext,
	requireClinicalFileTrash
} from '$lib/server/clinical-files';
import { enforceRateLimits, radiographRestoreRateLimitRules } from '$lib/server/rate-limits';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	event.setHeaders(clinicalFileCacheHeaders);
	try {
		const context = await getClinicalFileRequestContext(event);
		requireClinicalFileTrash(context);
		await enforceRateLimits(radiographRestoreRateLimitRules(context.userId), event.fetch);
		const { error } = await context.admin.rpc('restore_patient_radiograph' as never, {
			p_actor_id: context.userId,
			p_business_id: context.businessId,
			p_radiograph_id: event.params.radiographId
		} as never);
		if (error) throw error;
		return json({ id: event.params.radiographId, restored: true });
	} catch (cause) {
		console.error('Error restaurando imagen clínica', cause);
		const safe = clinicalFileError(cause, 'No pudimos restaurar la imagen. Probá de nuevo.');
		const headers = safe.retryAfterSeconds ? { 'retry-after': String(safe.retryAfterSeconds) } : undefined;
		return json(clinicalFileErrorBody(safe), { status: safe.status, headers });
	}
};

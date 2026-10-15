import {
	clinicalFileCacheHeaders,
	clinicalFileErrorBody,
	clinicalFileError,
	getClinicalFileRequestContext,
	requireClinicalFileUpload
} from '$lib/server/clinical-files';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	event.setHeaders(clinicalFileCacheHeaders);
	try {
		const context = await getClinicalFileRequestContext(event);
		requireClinicalFileUpload(context);
		const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
		const requestedReason = String(body.reason ?? '').trim();
		const reason = ['client_upload_failed', 'client_upload_aborted', 'client_upload_timeout'].includes(
			requestedReason
		)
			? requestedReason
			: 'client_upload_failed';
		const { error } = await context.admin.rpc('fail_patient_radiograph_upload' as never, {
			p_actor_id: context.userId,
			p_business_id: context.businessId,
			p_patient_id: event.params.id,
			p_radiograph_id: event.params.radiographId,
			p_failure_code: reason
		} as never);
		if (error) throw error;
		return json({ id: event.params.radiographId, failed: true });
	} catch (error) {
		console.error('Error registrando carga fallida', error);
		const safe = clinicalFileError(error, 'No pudimos actualizar el estado de la carga.');
		return json(clinicalFileErrorBody(safe), { status: safe.status });
	}
};

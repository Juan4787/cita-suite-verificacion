import {
	CLINICAL_FILE_ORIGINAL_URL_TTL_SECONDS,
	clinicalFileCacheHeaders,
	clinicalFileErrorBody,
	clinicalFileError,
	createSignedClinicalFileUrl,
	getClinicalFileRequestContext,
	requireClinicalFileView
} from '$lib/server/clinical-files';
import {
	enforceRateLimits,
	radiographOriginalAccessRateLimitRules
} from '$lib/server/rate-limits';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {clinicalDownloadName} from '$lib/clinical-documents';

export const POST: RequestHandler = async (event) => {
	event.setHeaders(clinicalFileCacheHeaders);
	try {
		const context = await getClinicalFileRequestContext(event);
		requireClinicalFileView(context);
		await enforceRateLimits(radiographOriginalAccessRateLimitRules(context.userId), event.fetch);

		const { data, error } = await context.admin.rpc(
			'grant_patient_radiograph_original_access' as never,
			{
				p_actor_id: context.userId,
				p_business_id: context.businessId,
				p_patient_id: event.params.id,
				p_radiograph_id: event.params.radiographId
			} as never
		);
		if (error) throw error;
		const row = (Array.isArray(data) ? data[0] : data) as
			| {
					storage_bucket: string;
					storage_path: string;
					original_filename: string | null;
					mime_type: string;
					bytes: number;
			  }
			| null;
		if (!row?.storage_path || !row.storage_bucket) throw new Error('RADIOGRAPH_NOT_FOUND');
        const {data:patient,error:patientError}=await context.supabase.from('patients').select('full_name').eq('business_id',context.businessId).eq('id',event.params.id).single();
        if(patientError||!patient)throw new Error('PATIENT_NOT_FOUND');
        const filename=clinicalDownloadName(patient.full_name,new Date().toISOString().slice(0,10),row.original_filename?.replace(/\.[^.]+$/,'')??'estudio',row.mime_type);

		const url = await createSignedClinicalFileUrl({
			admin: context.admin,
			bucket: row.storage_bucket,
			path: row.storage_path,
			expiresIn: CLINICAL_FILE_ORIGINAL_URL_TTL_SECONDS,
            ...(row.mime_type==='application/pdf'?{download:filename}:{})
		});

		return json({
			url,
			expires_at: new Date(Date.now() + CLINICAL_FILE_ORIGINAL_URL_TTL_SECONDS * 1000).toISOString(),
			filename,
			mime_type: row.mime_type,
			bytes: row.bytes
		});
	} catch (error) {
		console.error('Error concediendo acceso a imagen clínica', error);
		const safe = clinicalFileError(error, 'No pudimos abrir la imagen. Probá de nuevo.');
		const headers = safe.retryAfterSeconds ? { 'retry-after': String(safe.retryAfterSeconds) } : undefined;
		return json(clinicalFileErrorBody(safe), { status: safe.status, headers });
	}
};

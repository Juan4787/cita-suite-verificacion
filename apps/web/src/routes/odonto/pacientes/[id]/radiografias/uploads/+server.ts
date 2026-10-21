import { isUuid } from '@cita-suite/shared/uuid';
import { logServerFailure } from '$lib/server/platform/logging';
import {
	clinicalFileCacheHeaders,
	clinicalFileErrorBody,
	clinicalFileError,
	createClinicalFileUploadUrls,
	getClinicalFileRequestContext,
	isClinicalFileMime,
	normalizeClinicalDate,
	normalizeClinicalFilename,
	normalizeClinicalNote,
	requireClinicalFileUpload,
	CLINICAL_FILE_MAX_BYTES, readClinicalJson
} from '$lib/server/patients/public/clinical-files';
import { enforceRateLimits, radiographUploadRateLimitRules } from '$lib/server/platform/rate-limits';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const checksumPattern = /^[0-9a-f]{64}$/i;

export const POST: RequestHandler = async (event) => {
	event.setHeaders(clinicalFileCacheHeaders);

	try {
		const context = await getClinicalFileRequestContext(event);
		requireClinicalFileUpload(context);
		const body = await readClinicalJson(event.request);
		if (!body) {
			return json(
				{ code: 'INVALID_REQUEST', message: 'Revisá los datos del archivo.' },
				{ status: 400 }
			);
		}

		const clientRequestId = String(body.clientRequestId ?? '').trim();
		const originalFilename = normalizeClinicalFilename(body.originalFilename);
		const mimeType = body.mimeType;
		const bytes = Number(body.bytes);
		const sha256 = String(body.sha256 ?? '').trim().toLowerCase();
		const takenAt = normalizeClinicalDate(body.takenAt);
		const note = normalizeClinicalNote(body.note);

		if (!isUuid(clientRequestId) || !originalFilename || !checksumPattern.test(sha256)) {
			return json(
				{ code: 'INVALID_METADATA', message: 'Revisá los datos del archivo.' },
				{ status: 400 }
			);
		}
		if (!isClinicalFileMime(mimeType)) {
			return json(
				{ code: 'INVALID_FILE_TYPE', message: 'Elegí un archivo JPG, PNG o PDF.' },
				{ status: 400 }
			);
		}
		if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > CLINICAL_FILE_MAX_BYTES) {
			return json(
				{ code: 'FILE_TOO_LARGE', message: 'El archivo debe pesar hasta 5 MB.' },
				{ status: 400 }
			);
		}
		if (takenAt === undefined || note === undefined) {
			return json(
				{ code: 'INVALID_METADATA', message: 'Revisá la fecha y la nota del archivo.' },
				{ status: 400 }
			);
		}

		await enforceRateLimits(radiographUploadRateLimitRules(context.userId), event.fetch);
		const { data, error } = await context.admin.rpc('begin_patient_radiograph_upload', {
			p_actor_id: context.userId,
			p_business_id: context.businessId,
			p_patient_id: event.params.id,
			p_client_request_id: clientRequestId,
			p_original_filename: originalFilename,
			p_mime_type: mimeType,
			p_bytes: bytes,
			p_sha256: sha256,
			p_taken_at: takenAt,
			p_note: note
		});
		if (error) throw error;

		const row = data?.[0];
		if (!row?.radiograph_id) throw new Error('RADIOGRAPH_BEGIN_EMPTY');
		if (row.status === 'ready') {
			return json({ id: row.radiograph_id, already_complete: true });
		}
		if (row.status !== 'uploading') {
			return json(
				{ code: 'UPLOAD_CONFLICT', message: 'Esta carga ya terminó. Volvé a elegir el archivo.' },
				{ status: 409 }
			);
		}

		try {
			const urls = await createClinicalFileUploadUrls(context.admin, {
				original: row.storage_path,
				thumbnail: row.thumbnail_path
			});
			return json({
				id: row.radiograph_id,
				upload_url: urls.originalUrl,
				thumbnail_upload_url: urls.thumbnailUrl
			});
		} catch (error) {
			try {
				await context.admin.rpc('fail_patient_radiograph_upload', {
					p_actor_id: context.userId,
					p_business_id: context.businessId,
					p_patient_id: event.params.id,
					p_radiograph_id: row.radiograph_id,
					p_failure_code: 'signed_url_failed'
				});
			} catch {
				// La falla original se informa al usuario; este registro es de mejor esfuerzo.
			}
			throw error;
		}
	} catch (error) {
		logServerFailure('Error iniciando carga de imagen clínica', error);
		const safe = clinicalFileError(error, 'No pudimos iniciar la carga. Probá de nuevo.');
		const headers = safe.retryAfterSeconds ? { 'retry-after': String(safe.retryAfterSeconds) } : undefined;
		return json(clinicalFileErrorBody(safe), { status: safe.status, headers });
	}
};

import type { RequestHandler } from './$types';
import { patientExportFailure, patientExportJson } from '$lib/server/patient-export-http';
import {
	PatientExportError,
	createPatientExportAdminClient,
	getPatientExportActorId,
	isUuid,
	isValidPatientExportCounts,
	readPatientExportJson,
	validatePatientExport
} from '$lib/server/patient-exports';

export const POST: RequestHandler = async ({ request, params, locals, fetch }) => {
	try {
		if (!locals.auth) throw new PatientExportError('EXPORT_NOT_AUTHENTICATED');
		if (!isUuid(params.exportId)) throw new PatientExportError('EXPORT_INVALID_REQUEST');
		const body = await readPatientExportJson(request);
		if (
			Object.keys(body).length !== 1 ||
			!('received_counts' in body) ||
			!isValidPatientExportCounts(body.received_counts)
		) {
			throw new PatientExportError('EXPORT_INVALID_REQUEST');
		}

		const actorUserId = getPatientExportActorId(locals.auth);
		const supabase = await createPatientExportAdminClient(fetch);
		const validation = await validatePatientExport({
			supabase,
			actorUserId,
			exportId: params.exportId,
			receivedCounts: body.received_counts
		});
		return patientExportJson(validation);
	} catch (error) {
		return patientExportFailure(error);
	}
};

import type { RequestHandler } from './$types';
import { patientExportFailure, patientExportJson } from '$lib/server/patient-export-http';
import {
	PatientExportError,
	cancelPatientExport,
	createPatientExportAdminClient,
	getPatientExportActorId,
	isUuid
} from '$lib/server/patient-exports';

export const DELETE: RequestHandler = async ({ params, locals, fetch }) => {
	try {
		if (!locals.auth) throw new PatientExportError('EXPORT_NOT_AUTHENTICATED');
		if (!isUuid(params.exportId)) throw new PatientExportError('EXPORT_INVALID_REQUEST');

		const actorUserId = getPatientExportActorId(locals.auth);
		const supabase = await createPatientExportAdminClient(fetch);
		const result = await cancelPatientExport({
			supabase,
			actorUserId,
			exportId: params.exportId
		});
		return patientExportJson(result);
	} catch (error) {
		return patientExportFailure(error);
	}
};

import type { RequestHandler } from './$types';
import { patientExportFailure, patientExportJson } from '$lib/server/patient-export-http';
import {
	PatientExportError,
	assertPatientExportDataset,
	createPatientExportAdminClient,
	getPatientExportActorId,
	isUuid,
	readPatientExportPage
} from '$lib/server/patient-exports';

export const GET: RequestHandler = async ({ params, url, locals, fetch }) => {
	try {
		if (!locals.auth) throw new PatientExportError('EXPORT_NOT_AUTHENTICATED');
		if (!isUuid(params.exportId)) throw new PatientExportError('EXPORT_INVALID_REQUEST');
		const dataset = assertPatientExportDataset(params.dataset);
		const cursor = url.searchParams.get('cursor');
		if ([...url.searchParams.keys()].some((key) => key !== 'cursor')) {
			throw new PatientExportError('EXPORT_INVALID_REQUEST');
		}

		const actorUserId = getPatientExportActorId(locals.auth);
		const supabase = await createPatientExportAdminClient(fetch);
		const page = await readPatientExportPage({
			supabase,
			actorUserId,
			exportId: params.exportId,
			dataset,
			cursor
		});
		return patientExportJson(page);
	} catch (error) {
		return patientExportFailure(error);
	}
};

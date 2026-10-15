import type { RequestHandler } from './$types';
import { getOdontoContext } from '$lib/server/odonto-context';
import { canExportPatientData } from '$lib/server/patient-permissions';
import { patientExportFailure, patientExportJson } from '$lib/server/patient-export-http';
import {
	PatientExportError,
	createPatientExportAdminClient,
	isUuid,
	readPatientExportJson,
	startPatientExport
} from '$lib/server/patient-exports';

const INPUT_KEYS = new Set(['scope', 'patient_id', 'request_key']);

export const POST: RequestHandler = async ({ request, locals, fetch, cookies }) => {
	try {
		if (!locals.auth) throw new PatientExportError('EXPORT_NOT_AUTHENTICATED');
		const body = await readPatientExportJson(request);
		if (Object.keys(body).some((key) => !INPUT_KEYS.has(key))) {
			throw new PatientExportError('EXPORT_INVALID_REQUEST');
		}

		const scope = body.scope;
		const requestKey = body.request_key;
		const patientId = body.patient_id ?? null;
		if (
			(scope !== 'patient' && scope !== 'all_patients') ||
			!isUuid(requestKey) ||
			(scope === 'patient' && !isUuid(patientId)) ||
			(scope === 'all_patients' && patientId !== null)
		) {
			throw new PatientExportError('EXPORT_INVALID_REQUEST');
		}
		const normalizedPatientId = scope === 'patient' ? String(patientId) : null;

		const { business, userId } = await getOdontoContext({
			locals,
			fetch,
			cookies,
			membershipCache: 'fresh'
		});
		if (!canExportPatientData(business)) {
			throw new PatientExportError('EXPORT_NOT_AUTHORIZED');
		}
		const admin = await createPatientExportAdminClient(fetch);

		const session = await startPatientExport({
			supabase: admin,
			businessId: business.business.id,
			actorUserId: userId,
			scope,
			patientId: normalizedPatientId,
			requestKey,
			fetchImpl: fetch
		});
		return patientExportJson(session, session.reused ? 200 : 201);
	} catch (error) {
		return patientExportFailure(error);
	}
};

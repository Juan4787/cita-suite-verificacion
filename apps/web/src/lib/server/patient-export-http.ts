import { isRedirect, json } from '@sveltejs/kit';
import {
	PatientExportError,
	normalizePatientExportError,
	patientExportErrorBody
} from './patient-exports';

const BASE_HEADERS = {
	'cache-control': 'private, no-store',
	pragma: 'no-cache',
	vary: 'Cookie'
};

export const patientExportJson = (data: unknown, status = 200) =>
	json(data, { status, headers: BASE_HEADERS });

export const patientExportFailure = (error: unknown) => {
	let normalized: PatientExportError;
	if (isRedirect(error)) {
		normalized = new PatientExportError(
			error.location.startsWith('/login')
				? 'EXPORT_NOT_AUTHENTICATED'
				: 'EXPORT_DEPENDENCY_UNAVAILABLE',
			{ cause: error }
		);
	} else {
		normalized = normalizePatientExportError(error);
	}

	if (!(error instanceof PatientExportError) && !isRedirect(error)) {
		console.error('Error inesperado en API de exportación de pacientes', {
			name:
				typeof error === 'object' && error !== null && 'name' in error
					? String(error.name)
					: typeof error
		});
	}

	const headers: Record<string, string> = { ...BASE_HEADERS };
	if (normalized.retryAfterSeconds && normalized.retryAfterSeconds > 0) {
		headers['retry-after'] = String(normalized.retryAfterSeconds);
	}
	return json(patientExportErrorBody(normalized), {
		status: normalized.status,
		headers
	});
};

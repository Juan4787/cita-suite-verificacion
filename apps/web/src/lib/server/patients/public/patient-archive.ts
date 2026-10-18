import type { CitaSupabaseClient } from '$lib/types/database';
import type { BusinessContext } from '$lib/access/contracts';
import { resolvePatientPermissions } from './patient-permissions';
import { PatientOperationError, COMMERCIAL_RESTRICTED_MESSAGE } from './patient-operation-error';
import { logServerFailure } from '$lib/server/platform/logging';

/** The authenticated RPC derives global/personal scope from the current actor. */
export async function setPatientArchived({
	supabase,
	context,
	patientId,
	archived
}: {
	supabase: CitaSupabaseClient;
	context: BusinessContext;
	patientId: string;
	archived: boolean;
}): Promise<void> {
	if (!resolvePatientPermissions(context).canArchivePatient) {
		throw new PatientOperationError(
			'forbidden',
			context.access.allowedCapabilities.canEditPatient
				? 'Tu rol no permite archivar este paciente.'
				: COMMERCIAL_RESTRICTED_MESSAGE
		);
	}
	const { error } = await supabase.rpc('set_patient_archive_state_safely', {
		p_business_id: context.business.id,
		p_patient_id: patientId,
		p_archived: archived
	});
	if (!error) return;
	logServerFailure('patient.archive.failed', error);
	if (error.message.includes('BUSINESS_ACCESS_RESTRICTED'))
		throw new PatientOperationError('forbidden', COMMERCIAL_RESTRICTED_MESSAGE);
	if (error.message.includes('PROFESSIONAL_PATIENT_LINK_REQUIRED'))
		throw new PatientOperationError(
			'forbidden',
			'Este paciente no está asignado a tu perfil profesional.'
		);
	if (error.message.includes('PROFESSIONAL_LINK_REQUIRED'))
		throw new PatientOperationError(
			'forbidden',
			'Tu usuario no está vinculado a un profesional del consultorio.'
		);
	if (error.message.includes('PATIENT_ARCHIVE_DENIED') || error.message.includes('AUTH_REQUIRED'))
		throw new PatientOperationError('forbidden', 'No tenés permiso para archivar este paciente.');
	if (error.message.includes('PATIENT_NOT_FOUND'))
		throw new PatientOperationError('missing', 'Paciente no encontrado.');
	throw new PatientOperationError(
		'unavailable',
		'No se pudo actualizar el estado de la ficha. Intentá de nuevo.'
	);
}

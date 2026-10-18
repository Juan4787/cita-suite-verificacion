import type { CitaSupabaseClient } from '$lib/types/database';
import type { BusinessContext } from '$lib/access/contracts';
import { readPatientChangeEvents } from '$lib/patients/history-contract';
import { logServerFailure } from '$lib/server/platform/logging';
import { PatientOperationError } from './patient-operation-error';

/** Both reads use the authenticated client and the existing patient/audit RLS. */
export async function readPatientChanges({
	supabase,
	context,
	patientId
}: {
	supabase: CitaSupabaseClient;
	context: BusinessContext;
	patientId: string;
}) {
	const { data: patient, error: patientError } = await supabase
		.from('patients')
		.select('id')
		.eq('business_id', context.business.id)
		.eq('id', patientId)
		.maybeSingle();
	if (patientError) {
		logServerFailure('patient.changes.visibility.failed', patientError);
		throw new PatientOperationError(
			'unavailable',
			'No se pudieron cargar los últimos cambios. Volvé a intentar.'
		);
	}
	if (!patient) throw new PatientOperationError('missing', 'Paciente no encontrado o sin permiso.');
	const { data, error } = await supabase
		.from('patient_profile_change_events')
		.select('id, summary, changed_by_name, changed_fields, created_at')
		.eq('business_id', context.business.id)
		.eq('patient_id', patientId)
		.order('created_at', { ascending: false })
		.limit(5);
	if (error) {
		logServerFailure('patient.changes.read.failed', error);
		throw new PatientOperationError(
			'unavailable',
			'No se pudieron cargar los últimos cambios. Volvé a intentar.'
		);
	}
	return { change_events: readPatientChangeEvents({ change_events: data ?? [] }) };
}

import { isUuid } from '@cita-suite/shared/uuid';
import { logServerFailure } from '$lib/server/platform/logging';
import { error as kitError, redirect } from '@sveltejs/kit';
import { canExportPatientData } from '$lib/server/patients/public/patient-permissions';
import { createSupabaseServerClient } from '$lib/server/platform/supabase';
import type { PageServerLoad } from './$types';


export const load: PageServerLoad = async ({ parent, url, locals, fetch }) => {
	if (!locals.auth) throw redirect(303, '/login');

	const layoutData = await parent();
	const context = layoutData.activeBusiness;
	if (
		!context ||
		context.business.id === 'demo-business' ||
		!canExportPatientData(context)
	) {
		throw redirect(303, '/odonto/pacientes');
	}

	const patientId = url.searchParams.get('patient_id');
	if (!patientId) {
		return {
			scope: 'all_patients' as const,
			patient: null
		};
	}

	if (!isUuid(patientId)) {
		throw kitError(400, 'No pudimos identificar al paciente. Volvé a su ficha e intentá nuevamente.');
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const { data: patient, error } = await supabase
		.from('patients')
		.select('id, full_name')
		.eq('business_id', context.business.id)
		.eq('id', patientId)
		.maybeSingle();

	if (error) {
		logServerFailure('Error cargando paciente para exportacion individual', error);
		throw kitError(
			500,
			'No pudimos abrir la exportación de este paciente. Volvé a intentarlo en unos minutos.'
		);
	}
	if (!patient) {
		throw kitError(404, 'No encontramos ese paciente en el consultorio activo.');
	}

	return {
		scope: 'patient' as const,
		patient: {
			id: String(patient.id),
			name: String(patient.full_name || 'Paciente sin nombre')
		}
	};
};

import { error as kitError, redirect } from '@sveltejs/kit';
import { canExportPatientData } from '$lib/server/patient-permissions';
import { createSupabaseServerClient } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

	if (!UUID_PATTERN.test(patientId)) {
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
		console.error('Error cargando paciente para exportacion individual', error);
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

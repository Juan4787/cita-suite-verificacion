import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/platform/demo-store';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { readBoundedBookingForm } from '$lib/server/platform/form-data';
import {
	preparePatientRegistration,
	registerPatient,
	patientRegistrationFailure
} from '$lib/server/patients/public/patient-registration';
import {
	PATIENT_UNIQUE_CONFLICT_MESSAGES,
	type PatientUniqueField
} from '$lib/server/patients/public/patient-identity';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

const duplicatePatientResult = ({
	field,
	existingId,
	full_name,
	dni,
	phone
}: {
	field: PatientUniqueField;
	existingId: string;
	full_name: string;
	dni: string;
	phone: string;
}) => ({
	duplicate: true,
	duplicateField: field,
	message: PATIENT_UNIQUE_CONFLICT_MESSAGES[field],
	existingId,
	full_name,
	dni,
	phone
});

export const actions: Actions = {
	create_patient: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		let form: FormData;
		try {
			form = await readBoundedBookingForm(request);
		} catch {
			return fail(400, { message: 'Revisá los datos del paciente antes de guardar.' });
		}
		const input = preparePatientRegistration(form);
		const { full_name, dni, phone } = input;
		if (!full_name)
			return fail(400, { message: 'Nombre y apellido son obligatorios', full_name, dni, phone });
		if (env.DEMO_MODE === 'true') {
			const demoPatients = readDemoDb().patients;
			const existingByDni = dni ? demoPatients.find((patient) => patient.dni === dni) : null;
			if (existingByDni) {
				return duplicatePatientResult({
					field: 'dni',
					existingId: existingByDni.id,
					full_name,
					dni,
					phone
				});
			}

			let createdId: string | null = null;

			updateDemoDb((db) => {
				const now = new Date().toISOString();
				const id = newId('p');
				db.patients.unshift({
					id,
					full_name,
					dni: dni || null,
					phone: phone || null,
					email: null,
					birth_date: null,
					address: null,
					allergies: null,
					medication: null,
					background: null,
					insurance: null,
					custom_fields: null,
					archived_at: null,
					last_entry_at: null,
					created_at: now,
					updated_at: now
				});
				createdId = id;
			});

			if (!createdId) {
				return fail(500, {
					message: 'No se pudo crear el paciente. Intentá de nuevo.',
					full_name,
					dni,
					phone
				});
			}

			throw redirect(303, `/odonto/pacientes/${createdId}`);
		}

		const { supabase, business: context } = await getOdontoContext({ locals, fetch, cookies });
		if (!context.access.allowedCapabilities.canCreatePatient)
			return fail(403, {
				message:
					'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.',
				full_name,
				dni,
				phone
			});
		let result: Awaited<ReturnType<typeof registerPatient>>;
		try {
			result = await registerPatient(supabase, context.business.id, input);
		} catch (error) {
			logServerFailure('Error registrando paciente', error);
			const failure = patientRegistrationFailure(error);
			return fail(failure.status, { message: failure.message, full_name, dni, phone });
		}
		if (result.duplicate)
			return duplicatePatientResult({
				field: 'dni',
				existingId: result.patientId,
				full_name,
				dni,
				phone
			});
		throw redirect(303, `/odonto/pacientes/${result.patientId}`);
	}
};

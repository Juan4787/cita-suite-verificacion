import { normalizePhoneE164, normalizePhoneRaw } from '$lib/utils/phone';
import { normalizePhone } from '$lib/utils/format';
import type { CitaSupabaseClient } from '$lib/types/database';
import type { BusinessContext } from '$lib/access/contracts';
import { isRecord } from '$lib/contracts/json';
import { logServerFailure } from '$lib/server/platform/logging';
import { getProfessionalForUser as getCurrentProfessional } from '$lib/server/team/public/professionals';
import { getProfessionalPatientLink as ensureProfessionalCanAccessPatient } from './patient-links';
import { resolvePatientPermissions } from './patient-permissions';
import { PatientOperationError, COMMERCIAL_RESTRICTED_MESSAGE } from './patient-operation-error';
import {
	getPatientUniqueConflictField,
	getPatientWriteConflictMessage,
	PATIENT_UNIQUE_CONFLICT_MESSAGES,
	type PatientUniqueField
} from './patient-identity';
export type PatientProfileUpdate = {
	updates: {
		full_name: string;
		email: string | null;
		dni: string | null;
		birth_date: string | null;
		address: string | null;
		insurance: string | null;
		insurance_plan: string | null;
		phone: string | null;
		phone_raw: string | null;
		phone_e164: string | null;
		updated_at: string;
	};
	clinicalUpdates: {
		allergies: string | null;
		medication: string | null;
		background: string | null;
	};
	dni: string;
	expectedPatientUpdatedAt: string;
	expectedClinicalProfileUpdatedAt: string;
};
const isStaleUpdatedAt = (
	expected: string | null | undefined,
	current: string | null | undefined
): boolean => {
	if (!expected || !current) return false;
	if (expected === current) return false;
	const expectedMs = new Date(expected).getTime();
	const currentMs = new Date(current).getTime();
	if (Number.isNaN(expectedMs) || Number.isNaN(currentMs)) {
		return expected !== current;
	}
	return Math.abs(expectedMs - currentMs) > 1000;
};
const sentenceJoin = (items: string[]) => {
	if (items.length <= 1) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;
};
const patientFieldLabels: Record<string, string> = {
	full_name: 'nombre',
	dni: 'DNI',
	phone: 'teléfono',
	email: 'correo electrónico',
	birth_date: 'fecha de nacimiento',
	address: 'dirección',
	insurance: 'obra social',
	insurance_plan: 'plan de la obra social',
	allergies: 'alergias',
	medication: 'medicación',
	background: 'antecedentes'
};
const currentValue = (value: unknown) => {
	const text = String(value ?? '').trim();
	return text ? text : null;
};
const findPatientDuplicateDniForUpdate = async ({
	admin,
	businessId,
	patientId,
	dni
}: {
	admin: CitaSupabaseClient;
	businessId: string;
	patientId: string;
	dni: string;
}): Promise<{
	id: string;
	field: PatientUniqueField;
} | null> => {
	if (dni) {
		const { data, error } = await admin
			.from('patients')
			.select('id')
			.eq('business_id', businessId)
			.eq('dni', dni)
			.neq('id', patientId)
			.limit(1)
			.maybeSingle();
		if (error) throw error;
		if (data?.id) return { id: String(data.id), field: 'dni' };
	}
	return null;
};
const mapDuplicatePatientError = async ({
	error,
	admin,
	businessId,
	patientId,
	dni
}: {
	error:
		| {
				code?: string | null;
				message?: string | null;
				details?: string | null;
				hint?: string | null;
		  }
		| null
		| undefined;
	admin: CitaSupabaseClient;
	businessId: string;
	patientId: string;
	dni: string;
}) => {
	const conflictField = getPatientUniqueConflictField(error);
	if (conflictField) {
		let duplicate: { id: string; field: PatientUniqueField } | null = null;
		try {
			duplicate = await findPatientDuplicateDniForUpdate({
				admin,
				businessId,
				patientId,
				dni
			});
		} catch (lookupError) {
			logServerFailure('Error recuperando ficha en conflicto al editar paciente', lookupError);
		}
		if (duplicate) rejectDuplicatePatient(duplicate);
	}
	const conflictMessage = getPatientWriteConflictMessage(error);
	if (conflictMessage) throw new PatientOperationError('conflict', conflictMessage);
};
const patientUpdateRpcError = (
	error:
		| {
				message?: string;
				code?: string;
		  }
		| null
		| undefined,
	currentPatientUpdatedAt?: string | null,
	currentClinicalProfileUpdatedAt?: string | null
) => {
	const message = `${error?.message ?? ''} ${error?.code ?? ''}`;
	if (message.includes('BUSINESS_ACCESS_RESTRICTED')) {
		throw new PatientOperationError('forbidden', COMMERCIAL_RESTRICTED_MESSAGE);
	}
	if (message.includes('PATIENT_NOT_FOUND')) {
		throw new PatientOperationError('missing', 'Paciente no encontrado.');
	}
	if (message.includes('PATIENT_ACCESS_DENIED') || message.includes('PATIENT_UPDATE_DENIED')) {
		throw new PatientOperationError('forbidden', 'No tenés permiso para editar esta ficha.');
	}
	if (message.includes('PATIENT_NAME_REQUIRED')) {
		throw new PatientOperationError('invalid', 'Ingresá el nombre del paciente.');
	}
	if (message.includes('PATIENT_UPDATE_CONFLICT')) {
		throw new PatientOperationError('conflict', PATIENT_UPDATE_CONFLICT_MESSAGE, {
			currentPatientUpdatedAt: currentPatientUpdatedAt ?? '',
			currentClinicalProfileUpdatedAt: currentClinicalProfileUpdatedAt ?? ''
		});
	}
	return null;
};
const getActorName = (role: BusinessContext['role'], professionalName?: string | null) => {
	if (professionalName) return professionalName;
	if (role === 'owner') return 'Dueño';
	if (role === 'admin') return 'Administrador';
	if (role === 'reception') return 'Recepción';
	return 'Usuario del consultorio';
};
const changedFieldsForPatientUpdate = ({
	currentPatient,
	currentProfile,
	updates,
	clinicalUpdates
}: {
	currentPatient: Record<string, unknown> | null | undefined;
	currentProfile: Record<string, unknown> | null | undefined;
	updates: Record<string, unknown>;
	clinicalUpdates: Record<string, unknown>;
}) => {
	const changed: string[] = [];
	for (const key of [
		'full_name',
		'dni',
		'phone',
		'email',
		'birth_date',
		'address',
		'insurance',
		'insurance_plan'
	]) {
		if (currentValue(currentPatient?.[key]) !== currentValue(updates[key])) {
			changed.push(patientFieldLabels[key]);
		}
	}
	for (const key of ['allergies', 'medication', 'background']) {
		if (currentValue(currentProfile?.[key]) !== currentValue(clinicalUpdates[key])) {
			changed.push(patientFieldLabels[key]);
		}
	}
	return changed;
};
const PATIENT_UPDATE_CONFLICT_MESSAGE =
	'La ficha cambió mientras la editabas. Recargá la ficha, revisá los datos y volvé a guardar.';
const rejectDuplicatePatient = (existing: { id: string; field: PatientUniqueField }) => {
	throw new PatientOperationError('conflict', PATIENT_UNIQUE_CONFLICT_MESSAGES[existing.field], {
		duplicate: true,
		duplicateField: existing.field,
		existingId: existing.id
	});
};
const cleanText = (value: unknown) => {
	const text = String(value ?? '').trim();
	return text ? text : null;
};

export function parsePatientProfileUpdate(raw: Record<string, unknown>): PatientProfileUpdate {
	const full_name = String(raw.full_name ?? '')
		.trim()
		.replace(/\s+/g, ' ');
	const dni = String(raw.dni ?? '').trim();
	const phoneInput = String(raw.phone ?? '');
	const phone = normalizePhone(phoneInput);
	const birthDateRaw = String(raw.birth_date ?? '').trim();
	const expectedPatientUpdatedAt = String(raw.expected_patient_updated_at ?? '').trim();
	const expectedClinicalProfileUpdatedAt = String(
		raw.expected_clinical_profile_updated_at ?? ''
	).trim();

	if (!full_name) {
		throw new PatientOperationError('invalid', 'Ingresá el nombre del paciente.');
	}

	let birth_date: string | null = null;
	if (birthDateRaw) {
		const birthMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDateRaw);
		if (!birthMatch) {
			throw new PatientOperationError(
				'invalid',
				'Revisá la fecha de nacimiento. Formato esperado: Año/Mes/Día.'
			);
		}

		const y = Number(birthMatch[1]);
		const m = Number(birthMatch[2]);
		const d = Number(birthMatch[3]);
		const currentYear = new Date().getFullYear();

		if (!Number.isInteger(y) || y < 1900 || y > currentYear) {
			throw new PatientOperationError(
				'invalid',
				`Revisá el año: debe estar entre 1900 y ${currentYear}.`
			);
		}
		if (!Number.isInteger(m) || m < 1 || m > 12) {
			throw new PatientOperationError('invalid', 'Revisá el mes: debe ir del 1 al 12.');
		}
		const maxDay = new Date(y, m, 0).getDate();
		if (!Number.isInteger(d) || d < 1 || d > maxDay) {
			throw new PatientOperationError(
				'invalid',
				`Revisá el día: para ese mes debe ir del 1 al ${maxDay}.`
			);
		}

		birth_date = birthDateRaw;
	}

	const clinicalUpdates = {
		allergies: cleanText(raw.allergies),
		medication: cleanText(raw.medication),
		background: cleanText(raw.background)
	};
	const updates = {
		full_name,
		email: cleanText(raw.email),
		dni: dni || null,
		birth_date,
		address: cleanText(raw.address),
		insurance: cleanText(raw.insurance),
		insurance_plan: cleanText(raw.insurance_plan),
		phone: phone || null,
		phone_raw: normalizePhoneRaw(phoneInput),
		phone_e164: normalizePhoneE164(phoneInput),
		updated_at: new Date().toISOString()
	};

	return {
		updates,
		clinicalUpdates,
		dni,
		expectedPatientUpdatedAt,
		expectedClinicalProfileUpdatedAt
	};
}

export async function updatePatientProfile({
	admin,
	context,
	ownerId,
	patientId,
	input
}: {
	admin: CitaSupabaseClient;
	context: BusinessContext;
	ownerId: string;
	patientId: string;
	input: PatientProfileUpdate;
}): Promise<void> {
	const {
		updates,
		clinicalUpdates,
		dni,
		expectedPatientUpdatedAt,
		expectedClinicalProfileUpdatedAt
	} = input;
	const permissions = resolvePatientPermissions(context);
	if (!permissions.canEditPatient) {
		throw new PatientOperationError(
			'forbidden',
			context.access.allowedCapabilities.canEditPatient
				? 'Tu rol no permite editar datos de pacientes.'
				: COMMERCIAL_RESTRICTED_MESSAGE
		);
	}
	const currentProfessional =
		context.role === 'professional'
			? await getCurrentProfessional({
					admin,
					businessId: context.business.id,
					userId: ownerId
				})
			: null;
	if (context.role === 'professional') {
		if (!currentProfessional) {
			throw new PatientOperationError(
				'forbidden',
				'Tu usuario no está vinculado a un profesional del consultorio.'
			);
		}
		const link = await ensureProfessionalCanAccessPatient({
			admin,
			businessId: context.business.id,
			patientId: patientId,
			professionalId: currentProfessional.id
		});
		if (!link) {
			throw new PatientOperationError(
				'forbidden',
				'Este paciente no está asignado a tu perfil profesional.'
			);
		}
	}
	let duplicate: { id: string; field: PatientUniqueField } | null = null;
	try {
		duplicate = await findPatientDuplicateDniForUpdate({
			admin,
			businessId: context.business.id,
			patientId: patientId,
			dni
		});
	} catch (duplicateError) {
		logServerFailure('Error verificando duplicados al editar paciente', duplicateError);
		throw new PatientOperationError(
			'unavailable',
			'No pudimos comprobar si el DNI ya está asociado a otra ficha. Intentá de nuevo antes de guardar.'
		);
	}
	if (duplicate) rejectDuplicatePatient(duplicate);
	const [
		{ data: currentPatient, error: currentPatientError },
		{ data: currentProfile, error: currentProfileError }
	] = await Promise.all([
		admin
			.from('patients')
			.select(
				'full_name, dni, phone, email, birth_date, address, insurance, insurance_plan, updated_at'
			)
			.eq('id', patientId)
			.eq('business_id', context.business.id)
			.maybeSingle(),
		admin
			.from('patient_clinical_profiles')
			.select('allergies, medication, background, updated_at')
			.eq('patient_id', patientId)
			.eq('business_id', context.business.id)
			.maybeSingle()
	]);
	if (currentPatientError) {
		logServerFailure('Error cargando paciente antes de editar', currentPatientError);
		throw new PatientOperationError('unavailable', 'No se pudo cargar la ficha antes de guardar.');
	}
	if (!currentPatient) {
		throw new PatientOperationError('missing', 'Paciente no encontrado.');
	}
	if (
		expectedPatientUpdatedAt &&
		isStaleUpdatedAt(expectedPatientUpdatedAt, currentPatient.updated_at)
	) {
		throw new PatientOperationError('conflict', PATIENT_UPDATE_CONFLICT_MESSAGE, {
			currentPatientUpdatedAt: String(currentPatient.updated_at ?? ''),
			currentClinicalProfileUpdatedAt: String(currentProfile?.updated_at ?? '')
		});
	}
	if (currentProfileError) {
		logServerFailure('Error cargando perfil clínico antes de editar', currentProfileError);
		if (permissions.canEditClinicalProfile) {
			throw new PatientOperationError(
				'unavailable',
				'No se pudo cargar la información clínica antes de guardar. Intentá de nuevo.'
			);
		}
	}
	if (
		permissions.canEditClinicalProfile &&
		expectedClinicalProfileUpdatedAt &&
		isStaleUpdatedAt(expectedClinicalProfileUpdatedAt, currentProfile?.updated_at)
	) {
		throw new PatientOperationError('conflict', PATIENT_UPDATE_CONFLICT_MESSAGE, {
			currentPatientUpdatedAt: String(currentPatient.updated_at ?? ''),
			currentClinicalProfileUpdatedAt: String(currentProfile?.updated_at ?? '')
		});
	}
	// The history line travels with the change: the database writes both or neither.
	const changedFields = changedFieldsForPatientUpdate({
		currentPatient,
		currentProfile: permissions.canEditClinicalProfile ? currentProfile : null,
		updates,
		clinicalUpdates: permissions.canEditClinicalProfile ? clinicalUpdates : {}
	});
	const { data: atomicUpdate, error } = await admin.rpc(
		'update_patient_with_clinical_profile_safely',
		{
			p_actor_id: ownerId,
			p_business_id: context.business.id,
			p_patient_id: patientId,
			p_full_name: updates.full_name,
			p_dni: updates.dni,
			p_phone: updates.phone,
			p_phone_raw: updates.phone_raw,
			p_phone_e164: updates.phone_e164,
			p_email: updates.email,
			p_birth_date: updates.birth_date,
			p_address: updates.address,
			p_insurance: updates.insurance,
			p_insurance_plan: updates.insurance_plan,
			p_update_clinical_profile: permissions.canEditClinicalProfile,
			p_allergies: permissions.canEditClinicalProfile ? clinicalUpdates.allergies : null,
			p_medication: permissions.canEditClinicalProfile ? clinicalUpdates.medication : null,
			p_background: permissions.canEditClinicalProfile ? clinicalUpdates.background : null,
			p_expected_patient_updated_at: currentPatient.updated_at ?? null,
			p_expected_clinical_profile_updated_at: permissions.canEditClinicalProfile
				? (currentProfile?.updated_at ?? null)
				: null,
			p_changed_fields: changedFields,
			p_change_summary: changedFields.length > 0 ? `Se modificó: ${sentenceJoin(changedFields)}.` : null,
			p_changed_by_professional_id: currentProfessional?.id ?? null,
			p_changed_by_name: getActorName(context.role, currentProfessional?.name)
		}
	);
	if (error) {
		logServerFailure('Error actualizando ficha y perfil clínico del paciente', error);
		patientUpdateRpcError(error, currentPatient.updated_at, currentProfile?.updated_at);
		await mapDuplicatePatientError({
			error,
			admin,
			businessId: context.business.id,
			patientId: patientId,
			dni
		});
		throw new PatientOperationError(
			'unavailable',
			'No pudimos actualizar la ficha del paciente. Revisá los datos y volvé a intentar.'
		);
	}
	const savedAtomicUpdate = Array.isArray(atomicUpdate) ? atomicUpdate[0] : atomicUpdate;
	if (!isRecord(savedAtomicUpdate) || savedAtomicUpdate.patient_id !== patientId) {
		console.error('La actualización de paciente no devolvió una ficha confirmada');
		throw new PatientOperationError(
			'unavailable',
			'No se pudo confirmar la actualización de la ficha.'
		);
	}
}

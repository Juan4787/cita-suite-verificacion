import { isUuid } from '@cita-suite/shared/uuid';
import {
	isRecord,
	readRecord,
	readText,
	readBoolean,
	InvalidDataContractError
} from '$lib/contracts/json';
import type { CitaSupabaseClient } from '$lib/types/database';
import { normalizePhone } from '$lib/utils/format';
import { normalizePhoneE164, normalizePhoneRaw } from '$lib/utils/phone';
import { getPatientWriteConflictMessage } from './patient-identity';
export type PatientRegistrationInput = {
	full_name: string;
	dni: string;
	phone: string;
	phone_raw: string | null;
	phone_e164: string | null;
};
export function preparePatientRegistration(form: FormData): PatientRegistrationInput {
	const raw = String(form.get('phone') ?? '');
	return {
		full_name: String(form.get('full_name') ?? '').trim(),
		dni: String(form.get('dni') ?? '').trim(),
		phone: normalizePhone(raw).trim(),
		phone_raw: normalizePhoneRaw(raw),
		phone_e164: normalizePhoneE164(raw)
	};
}
export async function registerPatient(
	supabase: CitaSupabaseClient,
	businessId: string,
	input: PatientRegistrationInput
): Promise<{ patientId: string; duplicate: boolean }> {
	const id = crypto.randomUUID();
	const { data, error } = await supabase.rpc('register_patient_safely', {
		p_business_id: businessId,
		p_patient_id: id,
		p_full_name: input.full_name,
		p_dni: input.dni,
		p_phone: input.phone,
		p_phone_raw: input.phone_raw ?? '',
		p_phone_e164: input.phone_e164 ?? ''
	});
	if (error) throw error;
	const row = readRecord(data, 'patients.registration');
	const patientId = readText(row.patientId, 'patients.registration.id');
	const duplicate = readBoolean(row.duplicate, 'patients.registration.duplicate');
	if (
		!isUuid(patientId) ||
		(!duplicate && patientId !== id) ||
		(duplicate && !input.dni)
	)
		throw new InvalidDataContractError('patients.registration.identity');
	return { patientId, duplicate };
}
export function patientRegistrationFailure(error: unknown): { status: number; message: string } {
	const raw = isRecord(error) && typeof error.message === 'string' ? error.message : '';
	const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
	if (raw.includes('BUSINESS_ACCESS_RESTRICTED'))
		return {
			status: 403,
			message:
				'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.'
		};
	if (
		code === '42501' ||
		raw.includes('PATIENT_CREATE_DENIED') ||
		raw.includes('PROFESSIONAL_LINK_REQUIRED')
	)
		return {
			status: 403,
			message: 'Tu acceso cambió o no permite crear esta ficha. Recargá la pantalla para continuar.'
		};
	if (raw.includes('PATIENT_INPUT_INVALID'))
		return { status: 400, message: 'Revisá el nombre, DNI y teléfono del paciente.' };
	const conflict = getPatientWriteConflictMessage({ code, message: raw });
	if (conflict) return { status: 409, message: conflict };
	return {
		status: 503,
		message:
			'No pudimos confirmar el alta. Revisá la lista de pacientes antes de volver a intentarlo.'
	};
}

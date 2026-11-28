import { isUuid } from '@cita-suite/shared/uuid';
import { isRecord, readBoolean, readFiniteNumber, readRecord, readText } from '$lib/contracts/json';
import type { CitaSupabaseClient } from '$lib/types/database';

export type PatientDepositExemptionErrorCode =
	| 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN'
	| 'PATIENT_NOT_FOUND'
	| 'PATIENT_DEPOSIT_EXEMPTION_INVALID'
	| 'PATIENT_DEPOSIT_EXEMPTION_UNEXPECTED';

export class PatientDepositExemptionError extends Error {
	readonly code: PatientDepositExemptionErrorCode;
	readonly status: number;

	constructor(code: PatientDepositExemptionErrorCode) {
		super(code);
		this.name = 'PatientDepositExemptionError';
		this.code = code;
		this.status =
			code === 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN'
				? 403
				: code === 'PATIENT_NOT_FOUND'
					? 404
					: code === 'PATIENT_DEPOSIT_EXEMPTION_INVALID'
						? 400
						: 500;
	}
}

export const getPatientDepositExemptionErrorMessage = (code: PatientDepositExemptionErrorCode): string => {
	switch (code) {
		case 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN':
			return 'Sólo la dueña, la administración o la recepción pueden cambiar esta excepción de seña.';
		case 'PATIENT_NOT_FOUND':
			return 'No encontramos este paciente en el consultorio.';
		case 'PATIENT_DEPOSIT_EXEMPTION_INVALID':
			return 'No pudimos leer el cambio solicitado. Recargá la ficha y volvé a intentar.';
		default:
			return 'No pudimos guardar el cambio de excepción de seña. Volvé a intentar en unos segundos.';
	}
};

const KNOWN_CODES: readonly PatientDepositExemptionErrorCode[] = [
	'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN',
	'PATIENT_NOT_FOUND',
	'PATIENT_DEPOSIT_EXEMPTION_INVALID'
];

const parseCode = (error: unknown): PatientDepositExemptionErrorCode => {
	const row = isRecord(error) ? error : {};
	const raw = [row.message, row.details, row.hint].filter((part) => typeof part === 'string').join(' ');
	return KNOWN_CODES.find((code) => new RegExp(`(^|[^A-Z0-9_])${code}([^A-Z0-9_]|$)`).test(raw)) ?? 'PATIENT_DEPOSIT_EXEMPTION_UNEXPECTED';
};

export type PatientDepositExemptionResult = {
	exempt: boolean;
	updatedAt: string;
	updatedByName: string;
	updatedDeposits: number;
};

export const setPatientDepositAutoCancelExemption = async (
	supabase: CitaSupabaseClient,
	input: { businessId: string; patientId: string; exempt: boolean }
): Promise<PatientDepositExemptionResult> => {
	if (!isUuid(input.businessId) || !isUuid(input.patientId)) {
		throw new PatientDepositExemptionError('PATIENT_NOT_FOUND');
	}
	if (typeof input.exempt !== 'boolean') {
		throw new PatientDepositExemptionError('PATIENT_DEPOSIT_EXEMPTION_INVALID');
	}
	const { data, error } = await supabase.rpc('set_patient_deposit_auto_cancel_exemption', {
		p_business_id: input.businessId,
		p_patient_id: input.patientId,
		p_exempt: input.exempt
	});
	if (error) throw new PatientDepositExemptionError(parseCode(error));
	const row = readRecord(data, 'patientDepositExemption');
	const updatedDeposits = readFiniteNumber(row.updated_deposits, 'patientDepositExemption.updatedDeposits');
	if (!Number.isSafeInteger(updatedDeposits) || updatedDeposits < 0) {
		throw new PatientDepositExemptionError('PATIENT_DEPOSIT_EXEMPTION_UNEXPECTED');
	}
	return {
		exempt: readBoolean(row.exempt, 'patientDepositExemption.exempt'),
		updatedAt: readText(row.updated_at, 'patientDepositExemption.updatedAt'),
		updatedByName: readText(row.updated_by_name, 'patientDepositExemption.updatedByName'),
		updatedDeposits
	};
};

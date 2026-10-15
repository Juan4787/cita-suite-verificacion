import { describe, expect, it } from 'vitest';
import {
	getPatientUniqueConflictField,
	getPatientWriteConflictMessage,
	LEGACY_PATIENT_NAME_CONFLICT_MESSAGE,
	PATIENT_UNIQUE_CONFLICT_MESSAGES,
	UNKNOWN_PATIENT_UNIQUE_CONFLICT_MESSAGE
} from './patient-identity';

describe('patient identity conflicts', () => {
	it.each([
		[{ code: 'P0001', message: 'PATIENT_DNI_ALREADY_EXISTS' }, 'dni'],
		[
			{
				code: '23505',
				message: 'duplicate key value violates unique constraint "patients_business_dni_uq"'
			},
			'dni'
		]
	] as const)('identifica sin ambigüedad el dato en conflicto', (error, expectedField) => {
		expect(getPatientUniqueConflictField(error)).toBe(expectedField);
		expect(getPatientWriteConflictMessage(error)).toBe(
			PATIENT_UNIQUE_CONFLICT_MESSAGES[expectedField]
		);
	});

	it('no inventa que el conflicto desconocido sea de DNI o teléfono', () => {
		const error = {
			code: '23505',
			message: 'duplicate key value violates unique constraint "future_patient_constraint"'
		};

		expect(getPatientUniqueConflictField(error)).toBeNull();
		expect(getPatientWriteConflictMessage(error)).toBe(UNKNOWN_PATIENT_UNIQUE_CONFLICT_MESSAGE);
		expect(UNKNOWN_PATIENT_UNIQUE_CONFLICT_MESSAGE).not.toMatch(/DNI|teléfono/);
	});

	it('explica amigablemente una instalación antigua que todavía bloquea nombres iguales', () => {
		const error = { code: 'P0001', message: 'PATIENT_NAME_ALREADY_EXISTS' };

		expect(getPatientUniqueConflictField(error)).toBeNull();
		expect(getPatientWriteConflictMessage(error)).toBe(LEGACY_PATIENT_NAME_CONFLICT_MESSAGE);
		expect(LEGACY_PATIENT_NAME_CONFLICT_MESSAGE).toContain('dos personas pueden llamarse igual');
		expect(LEGACY_PATIENT_NAME_CONFLICT_MESSAGE).not.toContain('PATIENT_');
	});

	it('mantiene el mensaje de DNI humano y accionable', () => {
		const messages = Object.values(PATIENT_UNIQUE_CONFLICT_MESSAGES);
		expect(new Set(messages).size).toBe(messages.length);
		for (const message of messages) {
			expect(message).toMatch(/Abrila|revisá/);
			expect(message).not.toMatch(/23505|constraint|phone_e164|business_id/i);
		}
	});

	it('no trata un teléfono repetido como conflicto de identidad', () => {
		const legacyPhoneConstraint = {
			code: '23505',
			message: 'duplicate key value violates unique constraint "patients_business_phone_e164_uq"'
		};

		expect(getPatientUniqueConflictField(legacyPhoneConstraint)).toBeNull();
		expect(getPatientWriteConflictMessage(legacyPhoneConstraint)).toBe(
			UNKNOWN_PATIENT_UNIQUE_CONFLICT_MESSAGE
		);
	});
});

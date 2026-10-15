import { describe, expect, it } from 'vitest';
import {
	isValidPatientFullName,
	normalizePatientFullName,
	normalizePatientNameForComparison,
	patientFullNameErrorMessage,
	PATIENT_FULL_NAME_INVALID_ERROR_MESSAGE,
	PATIENT_FULL_NAME_REQUIRED_ERROR_MESSAGE
} from './patient-name';

describe('public patient full name', () => {
	it('trims and collapses whitespace without changing the spelling', () => {
		expect(normalizePatientFullName('  Carlos   Gime\u0301nez  ')).toBe('Carlos Giménez');
	});

	it.each([
		'María José Pérez',
		"Ana O'Connor",
		'Juan Pérez-Gómez',
		'José de la Cruz',
		'Li Wu'
	])('accepts a complete human name: %s', (name) => {
		expect(isValidPatientFullName(name)).toBe(true);
	});

	it.each(['Carlos', 'Carlos   ', 'Carlos 1', 'Carlos x', 'Carlos -', '1 Giménez'])
		('rejects an incomplete or artificial name: %s', (name) => {
			expect(isValidPatientFullName(name)).toBe(false);
		});

	it('compares without case, accent or whitespace differences', () => {
		expect(normalizePatientNameForComparison('  CARLOS   GIMÉNEZ ')).toBe('carlos gimenez');
		expect(normalizePatientNameForComparison('Carlos Gimenez')).toBe('carlos gimenez');
	});

	it('keeps ñ distinct from n', () => {
		expect(normalizePatientNameForComparison('Ana Peña')).toBe('ana peña');
		expect(normalizePatientNameForComparison('Ana Pena')).toBe('ana pena');
	});

	it('explica si falta el nombre o si el formato es artificial', () => {
		expect(patientFullNameErrorMessage('   ')).toBe(PATIENT_FULL_NAME_REQUIRED_ERROR_MESSAGE);
		expect(patientFullNameErrorMessage('Auditoria Samsung 2026')).toBe(
			PATIENT_FULL_NAME_INVALID_ERROR_MESSAGE
		);
		expect(patientFullNameErrorMessage('Ana Gómez')).toBe('');
	});
});

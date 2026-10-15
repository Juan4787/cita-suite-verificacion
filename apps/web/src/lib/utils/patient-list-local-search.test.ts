import { describe, expect, it } from 'vitest';
import { patientMatchesListQuery } from './patient-list-local-search';

const patient = {
	full_name: 'Jerónimo Núñez',
	dni: '32.456.789',
	phone_raw: '0351 15 123-4567',
	phone: '0351151234567',
	phone_e164: '+5493511234567'
};

describe('instant patient list filtering', () => {
	it('matches a single letter immediately and ignores accents', () => {
		expect(patientMatchesListQuery(patient, 'J')).toBe(true);
		expect(patientMatchesListQuery(patient, 'jero')).toBe(true);
		expect(patientMatchesListQuery(patient, 'nunez')).toBe(true);
		expect(patientMatchesListQuery(patient, 'x')).toBe(false);
	});

	it('matches DNI and phone regardless of punctuation', () => {
		expect(patientMatchesListQuery(patient, '456789')).toBe(true);
		expect(patientMatchesListQuery(patient, '351123')).toBe(true);
		expect(patientMatchesListQuery(patient, '999')).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';
import { readManualBookingPatients } from './manual-booking';
const patient = () => ({
	id: 'patient-one',
	full_name: 'Synthetic patient',
	phone: null,
	phone_raw: null,
	phone_e164: null,
	dni: null,
	birth_date: null,
	activity_at: '2026-01-01T12:00:00Z',
	blocked: false
});
describe('manual booking patient search boundary', () => {
	it('preserves complete rows and a genuinely empty result', () => {
		expect(readManualBookingPatients({ patients: [patient()] })).toEqual([patient()]);
		expect(readManualBookingPatients({ patients: [] })).toEqual([]);
	});
	it.each([
		{},
		{ patients: [{}] },
		{ patients: null },
		{ patients: [patient(), patient()] },
		{ patients: [{ ...patient(), blocked: 'false' }] },
		{ patients: [{ ...patient(), activity_at: 'invalid' }] },
		{ patients: Array.from({ length: 13 }, (_, i) => ({ ...patient(), id: String(i) })) }
	])('rejects an incomplete, contradictory or unbounded response (%j)', (value) => {
		expect(() => readManualBookingPatients(value)).toThrow();
	});
});

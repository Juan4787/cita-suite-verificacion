import { describe, expect, it } from 'vitest';
import { InvalidDataContractError } from '$lib/contracts/json';
import { readPatientBookingAge } from './booking-profile';

describe('booking age stored namespace', () => {
	it('preserves unrelated historical metadata without inventing an age', () => {
		for (const value of [null, ['legacy'], { unrelated: 'legacy' }])
			expect(readPatientBookingAge(value)).toBeNull();
	});
	it('retains the valid stored age and its calendar reference, including zero and 130', () => {
		for (const years of [0, 35, 130])
			expect(readPatientBookingAge({ booking_age: { years, as_of: '2024-02-29' } })).toEqual({
				years,
				as_of: '2024-02-29'
			});
	});
	it('rejects invalid owned metadata without leaking its value', () => {
		for (const age of [
			{ years: 'PRIVATE_SENTINEL', as_of: '2026-01-01' },
			{ years: 131, as_of: '2026-01-01' },
			{ years: 35.5, as_of: '2026-01-01' },
			{ years: 35, as_of: '2026-02-30' }
		]) {
			try {
				readPatientBookingAge({ booking_age: age });
				throw new Error('Expected age rejection');
			} catch (cause) {
				expect(cause).toBeInstanceOf(InvalidDataContractError);
				expect(String(cause)).not.toContain('PRIVATE_SENTINEL');
			}
		}
	});
});

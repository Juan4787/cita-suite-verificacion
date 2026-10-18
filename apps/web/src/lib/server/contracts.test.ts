import { describe, expect, it } from 'vitest';
import { InvalidDataContractError, readJson } from '$lib/contracts/json';
import { parsePatientBookingProfile } from '$lib/patients/booking-profile';
import { parseIntegratedAvailabilityRows } from '$lib/availability/rows';

describe('runtime JSON contracts', () => {
	it('preserves JSON values, optional object fields and literal prototype keys', () => {
		const input = JSON.parse('{"__proto__":{"label":"preserved"},"values":[null,false,3,"text"]}');
		input.optional = undefined;
		const result = readJson(input, 'test');
		expect(JSON.stringify(result)).toBe('{"__proto__":{"label":"preserved"},"values":[null,false,3,"text"]}');
		expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
	});
	it('rejects non-JSON, cycles and invalid numeric values without including the data in the error', () => {
		const cycle: Record<string, unknown> = {}; cycle.next = cycle;
		for (const value of [undefined, NaN, Infinity, 1n, () => {}, [undefined], new Date(), cycle]) {
			expect(() => readJson(value, 'test')).toThrow(InvalidDataContractError);
		}
	});
	it('validates booking fields while preserving unrelated historical metadata', () => {
		expect(parsePatientBookingProfile(['legacy'])).toEqual({ fields: [], reportedAtMs: null });
		expect(parsePatientBookingProfile({ booking_fields: { a: { label: 'Seguro', value: false } }, booking_last_reported_at: '2026-10-01T12:00:00Z' }))
			.toEqual({ fields: [{ label: 'Seguro', value: false }], reportedAtMs: Date.parse('2026-10-01T12:00:00Z') });
		expect(() => parsePatientBookingProfile({ booking_fields: { a: { label: 'Seguro', value: 7 } } })).toThrow(InvalidDataContractError);
		expect(() => parsePatientBookingProfile({ booking_last_reported_at: 'invalid' })).toThrow(InvalidDataContractError);
	});
	it('accepts an explicitly empty availability snapshot and rejects incomplete or malformed snapshots', () => {
		const empty = { services: [], professionals: [], assignments: [], rules: [], exceptions: [], blocks: [] };
		expect(parseIntegratedAvailabilityRows(empty)).toEqual(empty);
		for (const value of [null, {}, { ...empty, blocks: null }, { ...empty, blocks: [{ id: 'incomplete' }] }, { ...empty, rules: [{ service_scope: 'unknown' }] }])
			expect(() => parseIntegratedAvailabilityRows(value)).toThrow(InvalidDataContractError);
	});
});

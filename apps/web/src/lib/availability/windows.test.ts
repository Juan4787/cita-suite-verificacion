import { describe, expect, it } from 'vitest';
import { availabilityDateWindows, availabilityProfessionalGroups, shiftAvailabilityDate } from './windows';

describe('fixed availability windows', () => {
	it('counts fifteen inclusive natural dates across months and leap day', () => {
		expect([...availabilityDateWindows('2028-02-20', '2028-03-21')]).toEqual([
			{ fromDate: '2028-02-20', toDate: '2028-03-05' },
			{ fromDate: '2028-03-06', toDate: '2028-03-20' },
			{ fromDate: '2028-03-21', toDate: '2028-03-21' }
		]);
	});
	it('leaves an exact fifteen-date request in one window and does not fetch later dates', () => {
		expect([...availabilityDateWindows('2027-11-01', '2027-11-15')]).toEqual([
			{ fromDate: '2027-11-01', toDate: '2027-11-15' }
		]);
		expect([...availabilityDateWindows('2027-03-01', '2027-03-16')]).toHaveLength(2);
	});
	it('supports teams larger than a query group, preserving every identifier', () => {
		const ids = Array.from({ length: 35 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
		const groups = [...availabilityProfessionalGroups([...ids, ids[0]])];
		expect(groups.map(group => group.length)).toEqual([16, 16, 3]);
		expect(groups.flat()).toEqual(ids);
		expect([...availabilityProfessionalGroups([])]).toEqual([]);
	});
	it('rejects malformed dates, reversed ranges and invalid identifiers explicitly', () => {
		expect(() => [...availabilityDateWindows('2027-02-30', '2027-03-15')]).toThrow();
		expect(() => [...availabilityDateWindows('2027-03-16', '2027-03-15')]).toThrow();
		expect(() => [...availabilityProfessionalGroups(['invalid'])]).toThrow();
		expect(shiftAvailabilityDate('2028-02-28', 1)).toBe('2028-02-29');
	});
});

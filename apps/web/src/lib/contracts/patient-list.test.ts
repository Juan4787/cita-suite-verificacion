import { describe, expect, it } from 'vitest';
import { InvalidDataContractError } from './json';
import { parsePatientListData, type PatientListData } from './patient-list';

const snapshot = (): PatientListData => ({
	businessId: 'synthetic-clinic', patients: [], query: '', showArchived: false,
	demo: false, canCreatePatient: false, canAccessRadiographTrash: false,
	totalCount: 0, activeCount: 0, archivedCount: 0, countsIncluded: true,
	countsSource: 'rpc', hasMore: false, nextCursor: null, snapshotAt: null,
	pageSize: 30, cacheable: true, revision: '0', cacheScope: 'synthetic-private-scope',
	loadedAt: '2026-10-16T10:00:00.000Z'
});

describe('patient list HTTP contract', () => {
	it('preserves an explicitly complete empty list and zero revision', () => {
		expect(parsePatientListData(snapshot())).toEqual(snapshot());
	});

	it('keeps nonempty patient identity and professional archive context', () => {
		const data = snapshot();
		data.patients = [{ id: 'synthetic-patient', full_name: 'Paciente Sintético',
			dni: null, phone: '+5491112345678', archived_at: null, created_at: null,
			updated_at: null, last_entry_at: null, professional_archived_at: '2026-10-01T10:00:00Z' }];
		data.totalCount = data.activeCount = 1;
		expect(parsePatientListData(data)).toEqual(data);
	});

	it.each([
		{ patients: undefined }, { patients: null }, { patients: [{}] },
		{ hasMore: 'false' }, { hasMore: true, nextCursor: null }, { totalCount: -1 }, { activeCount: 1.5 },
		{ cacheScope: null }, { revision: null }, { businessId: null },
		{ countsSource: 'unknown' }, { pageSize: 0 }
	])('rejects incomplete or contradictory successful responses: %j', overrides => {
		expect(() => parsePatientListData({ ...snapshot(), ...overrides })).toThrow(InvalidDataContractError);
	});

	it('allows the explicit uncacheable demo profile', () => {
		const data = { ...snapshot(), businessId: null, cacheable: false, revision: null, cacheScope: null, demo: true };
		expect(parsePatientListData(data)).toEqual(data);
	});

	it('accepts only the requested clinic, archive state and normalized query', () => {
		const data = snapshot();
		expect(parsePatientListData(data, { businessId: data.businessId, showArchived: false, query: '' })).toEqual(data);
		for (const expected of [{ businessId: 'different-clinic' }, { showArchived: true }, { query: 'different' }]) {
			expect(() => parsePatientListData(data, expected)).toThrow(InvalidDataContractError);
		}
	});

	it('keeps the cache search identity when only case or edge whitespace differs', () => {
		const data = { ...snapshot(), query: 'Juan' };
		expect(parsePatientListData(data, { query: '  JUAN  ' })).toEqual(data);
	});
});

import { describe, expect, it, vi } from 'vitest';
import {
	loadStablePatientListRevision,
	normalizePatientListQuery,
	withUncacheablePatientListMetadata
} from './patient-list';

const rows = (label: string) => ({
	patients: [{ id: label }],
	query: '' as const,
	showArchived: false,
	demo: false,
	canCreatePatient: true,
	canAccessRadiographTrash: true,
	totalCount: 1,
	activeCount: 1,
	archivedCount: 0,
	countsIncluded: true,
	countsSource: 'rpc' as const,
	hasMore: false,
	nextCursor: null,
	snapshotAt: '2026-08-20T12:00:00.000Z',
	pageSize: 30
});

const revision = (value: string) => ({
	cacheable: true,
	revision: value,
	topic: `business-data:topic-${value}`
});

describe('stable patient list revision', () => {
	it('starts global search at one trimmed character and caps its input', () => {
		expect(normalizePatientListQuery(null)).toBe('');
		expect(normalizePatientListQuery(' a ')).toBe('a');
		expect(normalizePatientListQuery(' an ')).toBe('an');
		expect(normalizePatientListQuery(`  ${'x'.repeat(100)}  `)).toHaveLength(80);
	});

	it('never marks a cursor page as a complete cacheable snapshot', () => {
		const result = withUncacheablePatientListMetadata(rows('next-page'), 'business-1');

		expect(result).toMatchObject({
			businessId: 'business-1',
			patients: [{ id: 'next-page' }],
			cacheable: false,
			revision: null,
			cacheScope: null
		});
	});

	it('returns a cacheable list only when the revision is identical before and after the read', async () => {
		const readRevision = vi.fn().mockResolvedValue(revision('12'));
		const loadRows = vi.fn().mockResolvedValue(rows('stable'));

		const result = await loadStablePatientListRevision({
			readRevision,
			loadRows,
			cacheScope: 'scope-1',
			businessId: 'business-1'
		});

		expect(result).toMatchObject({
			businessId: 'business-1',
			cacheable: true,
			revision: '12',
			cacheScope: 'scope-1'
		});
		expect(readRevision).toHaveBeenCalledTimes(2);
		expect(loadRows).toHaveBeenCalledTimes(1);
	});

	it('discards a list read concurrently with a mutation and retries from the new revision', async () => {
		const readRevision = vi
			.fn()
			.mockResolvedValueOnce(revision('20'))
			.mockResolvedValueOnce(revision('21'))
			.mockResolvedValueOnce(revision('21'))
			.mockResolvedValueOnce(revision('21'));
		const loadRows = vi
			.fn()
			.mockResolvedValueOnce(rows('discarded'))
			.mockResolvedValueOnce(rows('current'));

		const result = await loadStablePatientListRevision({
			readRevision,
			loadRows,
			cacheScope: 'scope-1',
			businessId: 'business-1'
		});

		expect(result.patients).toEqual([{ id: 'current' }]);
		expect(result.revision).toBe('21');
		expect(loadRows).toHaveBeenCalledTimes(2);
	});

	it('keeps working without cache when the migration is not deployed yet', async () => {
		const readRevision = vi.fn().mockResolvedValue({
			cacheable: false,
			revision: null,
			topic: null
		});
		const loadRows = vi.fn().mockResolvedValue(rows('fresh'));

		const result = await loadStablePatientListRevision({
			readRevision,
			loadRows,
			cacheScope: 'scope-1',
			businessId: 'business-1'
		});

		expect(result).toMatchObject({ cacheable: false, revision: null, cacheScope: null });
		expect(readRevision).toHaveBeenCalledTimes(1);
	});

	it('fails safely instead of returning a perpetually changing snapshot', async () => {
		let value = 30;
		const readRevision = vi.fn(async () => revision(String(value++)));
		const loadRows = vi.fn(async () => rows('changing'));

		await expect(
			loadStablePatientListRevision({
				readRevision,
				loadRows,
				cacheScope: 'scope-1',
				businessId: 'business-1'
			})
		).rejects.toMatchObject({ status: 503 });
		expect(loadRows).toHaveBeenCalledTimes(3);
	});
});

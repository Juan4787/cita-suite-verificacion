// @vitest-environment jsdom
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	PATIENT_LIST_CACHE_TTL_MS,
	PATIENT_REVISION_VERIFICATION_MAX_AGE_MS,
	acceptPatientListSnapshot,
	acceptVerifiedPatientRevision,
	consumePatientListNavigation,
	getCachedPatientList,
	getCurrentVerifiedPatientRevision,
	isPatientListSnapshotCurrent,
	observePatientRevisionEvent,
	patientRevisionState,
	rememberPatientListNavigation,
	resetPatientListClientState,
	setCachedPatientList,
	type PatientListSnapshot
} from './patient-list-cache';

const snapshot = (
	revision = '4',
	overrides: Partial<PatientListSnapshot> = {}
): PatientListSnapshot => ({
	businessId: 'business-1',
	showArchived: false,
	query: '',
	cacheable: true,
	revision,
	cacheScope: 'private-scope-1',
	patients: [{ id: 'patient-1', full_name: 'Paciente de prueba' }],
	...overrides
});

describe('patient list private memory cache', () => {
	beforeEach(() => resetPatientListClientState());

	it('reuses a list only for the exact scope, filter and verified revision', () => {
		const data = snapshot();
		expect(acceptPatientListSnapshot(data)).toBe(true);
		setCachedPatientList(data, 1_000);

		expect(
			getCachedPatientList({
				cacheScope: 'private-scope-1',
				showArchived: false,
				query: '',
				revision: '4',
				now: 1_500
			})
		).toBe(data);
		expect(
			getCachedPatientList({
				cacheScope: 'private-scope-1',
				showArchived: true,
				query: '',
				revision: '4',
				now: 1_500
			})
		).toBeNull();
		expect(
			getCachedPatientList({
				cacheScope: 'private-scope-1',
				showArchived: false,
				query: '',
				revision: '5',
				now: 1_500
			})
		).toBeNull();
	});

	it('expires patient data after two minutes even when the revision did not change', () => {
		const data = snapshot();
		acceptPatientListSnapshot(data);
		setCachedPatientList(data, 2_000);

		expect(
			getCachedPatientList({
				cacheScope: 'private-scope-1',
				showArchived: false,
				query: '',
				revision: '4',
				now: 2_000 + 90_000
			})
		).toBe(data);
		expect(
			getCachedPatientList({
				cacheScope: 'private-scope-1',
				showArchived: false,
				query: '',
				revision: '4',
				now: 2_000 + PATIENT_LIST_CACHE_TTL_MS
			})
		).toBeNull();
	});

	it('uses the verified revision without HTTP only inside the safety window', () => {
		acceptPatientListSnapshot(snapshot('6'));
		const verifiedAt = get(patientRevisionState).lastVerifiedAt;

		expect(getCurrentVerifiedPatientRevision('business-1', verifiedAt + 5_000)).toEqual({
			cacheScope: 'private-scope-1',
			revision: '6'
		});
		expect(
			getCurrentVerifiedPatientRevision(
				'business-1',
				verifiedAt + PATIENT_REVISION_VERIFICATION_MAX_AGE_MS + 1
			)
		).toBeNull();
	});

	it('invalidates immediately when a newer database event arrives', () => {
		const data = snapshot('7');
		acceptPatientListSnapshot(data);
		setCachedPatientList(data, 1_000);

		expect(observePatientRevisionEvent('business-1', '8')).toBe(true);
		expect(get(patientRevisionState)).toMatchObject({
			businessId: 'business-1',
			revision: '8',
			status: 'unverified'
		});
		expect(isPatientListSnapshotCurrent(data)).toBe(false);
		expect(
			getCachedPatientList({
				cacheScope: 'private-scope-1',
				showArchived: false,
				query: '',
				revision: '7',
				now: 1_001
			})
		).toBeNull();
	});

	it('never downgrades to a late HTTP response older than an observed event', () => {
		acceptVerifiedPatientRevision({
			businessId: 'business-1',
			cacheable: true,
			revision: '10',
			cacheScope: 'private-scope-1'
		});
		observePatientRevisionEvent('business-1', '11');

		expect(
			acceptVerifiedPatientRevision({
				businessId: 'business-1',
				cacheable: true,
				revision: '10',
				cacheScope: 'private-scope-1'
			})
		).toBe(false);
		expect(get(patientRevisionState)).toMatchObject({ revision: '11', status: 'unverified' });
	});

	it('clears the previous identity when user, role or business scope changes', () => {
		const original = snapshot();
		acceptPatientListSnapshot(original);
		setCachedPatientList(original, 1_000);

		acceptVerifiedPatientRevision({
			businessId: 'business-2',
			cacheable: true,
			revision: '1',
			cacheScope: 'private-scope-2'
		});
		expect(
			getCachedPatientList({
				cacheScope: 'private-scope-1',
				showArchived: false,
				query: '',
				revision: '4',
				now: 1_001
			})
		).toBeNull();
	});

	it('isolates cached rows by normalized server search query', () => {
		const juan = snapshot('12', { query: '  Juan  ' });
		acceptPatientListSnapshot(juan);
		setCachedPatientList(juan, 1_000);

		expect(
			getCachedPatientList({
				cacheScope: 'private-scope-1',
				showArchived: false,
				query: 'juan',
				revision: '12',
				now: 1_001
			})
		).toBe(juan);
		expect(
			getCachedPatientList({
				cacheScope: 'private-scope-1',
				showArchived: false,
				query: 'maría',
				revision: '12',
				now: 1_001
			})
		).toBeNull();
	});

	it('restores only non-clinical navigation context once and only in the exact scope', () => {
		rememberPatientListNavigation({
			businessId: 'business-1',
			showArchived: false,
			query: '  JUAN ',
			loadedCount: 61.9,
			scrollY: 840.7,
			now: 5_000
		});

		expect(
			consumePatientListNavigation({
				businessId: 'business-1',
				showArchived: false,
				query: 'juan',
				now: 5_001
			})
		).toEqual({ loadedCount: 61, scrollY: 840 });
		expect(
			consumePatientListNavigation({
				businessId: 'business-1',
				showArchived: false,
				query: 'juan',
				now: 5_002
			})
		).toBeNull();

		rememberPatientListNavigation({
			businessId: 'business-1',
			showArchived: true,
			query: '',
			loadedCount: 30,
			scrollY: 400,
			now: 6_000
		});
		expect(
			consumePatientListNavigation({
				businessId: 'business-2',
				showArchived: true,
				query: '',
				now: 6_001
			})
		).toBeNull();
	});
});

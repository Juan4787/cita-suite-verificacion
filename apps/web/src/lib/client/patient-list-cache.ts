import { get, writable } from 'svelte/store';

export const PATIENT_LIST_CACHE_TTL_MS = 2 * 60 * 1000;
export const PATIENT_REVISION_VERIFICATION_MAX_AGE_MS = 35_000;
const MAX_CACHE_ENTRIES = 8;
const NAVIGATION_CONTEXT_TTL_MS = 10 * 60 * 1000;

export type PatientListSnapshot = {
	businessId: string | null;
	showArchived: boolean;
	query: string;
	cacheable: boolean;
	revision: string | null;
	cacheScope: string | null;
	[key: string]: unknown;
};

export type PatientRevisionSnapshot = {
	resource: 'patients';
	businessId: string;
	cacheable: boolean;
	revision: string | null;
	cacheScope: string | null;
	topic: string | null;
	checkedAt: string;
};

export type PatientRevisionState = {
	businessId: string | null;
	cacheScope: string | null;
	revision: string | null;
	status: 'idle' | 'verified' | 'unverified' | 'disabled';
	lastVerifiedAt: number;
};

type CacheEntry = {
	data: PatientListSnapshot;
	expiresAt: number;
	storedAt: number;
};

const initialRevisionState = (): PatientRevisionState => ({
	businessId: null,
	cacheScope: null,
	revision: null,
	status: 'idle',
	lastVerifiedAt: 0
});

const patientListCache = new Map<string, CacheEntry>();
const verificationInFlight = new Map<string, Promise<PatientRevisionSnapshot>>();
let patientListNavigationContext: {
	businessId: string;
	showArchived: boolean;
	query: string;
	loadedCount: number;
	scrollY: number;
	expiresAt: number;
} | null = null;

export const patientRevisionState = writable<PatientRevisionState>(initialRevisionState());

const normalizeRevision = (value: unknown) => {
	const revision = String(value ?? '').trim();
	return /^\d+$/.test(revision) ? revision : null;
};

const compareRevisions = (left: string, right: string) => {
	const leftValue = BigInt(left);
	const rightValue = BigInt(right);
	return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
};

const normalizeQuery = (query: string) => query.trim().toLocaleLowerCase('es');

const cacheKey = (cacheScope: string, showArchived: boolean, query: string) =>
	`${cacheScope}:${showArchived ? 'archived' : 'active'}:${normalizeQuery(query)}`;

const prunePatientListCache = (now: number) => {
	for (const [key, entry] of patientListCache) {
		if (entry.expiresAt <= now) patientListCache.delete(key);
	}
	if (patientListCache.size <= MAX_CACHE_ENTRIES) return;
	const oldest = [...patientListCache.entries()].sort(
		(left, right) => left[1].storedAt - right[1].storedAt
	);
	for (const [key] of oldest.slice(0, patientListCache.size - MAX_CACHE_ENTRIES)) {
		patientListCache.delete(key);
	}
};

export const getCachedPatientList = ({
	cacheScope,
	showArchived,
	query,
	revision,
	now = Date.now()
}: {
	cacheScope: string;
	showArchived: boolean;
	query: string;
	revision: string;
	now?: number;
}): PatientListSnapshot | null => {
	if (typeof window === 'undefined') return null;
	prunePatientListCache(now);
	const entry = patientListCache.get(cacheKey(cacheScope, showArchived, query));
	if (!entry || entry.data.revision !== revision || entry.expiresAt <= now) return null;
	return entry.data;
};

export const setCachedPatientList = (
	data: PatientListSnapshot,
	now = Date.now()
) => {
	if (
		typeof window === 'undefined' ||
		!data.cacheable ||
		!data.cacheScope ||
		!normalizeRevision(data.revision)
	) {
		return;
	}
	patientListCache.set(cacheKey(data.cacheScope, data.showArchived, data.query), {
		data,
		storedAt: now,
		expiresAt: now + PATIENT_LIST_CACHE_TTL_MS
	});
	prunePatientListCache(now);
};

export const invalidatePatientListCache = (cacheScope?: string | null) => {
	if (!cacheScope) {
		patientListCache.clear();
		return;
	}
	for (const [key] of patientListCache) {
		if (key.startsWith(`${cacheScope}:`)) patientListCache.delete(key);
	}
};

const parseRevisionSnapshot = (value: unknown): PatientRevisionSnapshot => {
	const row = (value ?? {}) as Record<string, unknown>;
	const businessId = String(row.businessId ?? '').trim();
	const cacheable = row.cacheable === true;
	const revision = normalizeRevision(row.revision);
	const cacheScope = String(row.cacheScope ?? '').trim() || null;
	const topic = String(row.topic ?? '').trim() || null;
	if (
		row.resource !== 'patients' ||
		!businessId ||
		(cacheable && (!revision || !cacheScope || !topic))
	) {
		throw new Error('No pudimos verificar si la lista de pacientes está actualizada.');
	}
	return {
		resource: 'patients',
		businessId,
		cacheable,
		revision: cacheable ? revision : null,
		cacheScope: cacheable ? cacheScope : null,
		topic: cacheable ? topic : null,
		checkedAt: String(row.checkedAt ?? '')
	};
};

export const acceptVerifiedPatientRevision = (
	snapshot: Omit<PatientRevisionSnapshot, 'resource' | 'checkedAt' | 'topic'> & {
		topic?: string | null;
	}
) => {
	const current = get(patientRevisionState);
	if (!snapshot.cacheable || !snapshot.revision || !snapshot.cacheScope) {
		invalidatePatientListCache(current.cacheScope);
		patientRevisionState.set({
			businessId: snapshot.businessId,
			cacheScope: null,
			revision: null,
			status: 'disabled',
			lastVerifiedAt: Date.now()
		});
		return true;
	}

	if (
		current.businessId === snapshot.businessId &&
		current.revision &&
		compareRevisions(snapshot.revision, current.revision) < 0
	) {
		patientRevisionState.set({ ...current, status: 'unverified', lastVerifiedAt: 0 });
		return false;
	}

	const identityChanged =
		current.businessId !== snapshot.businessId || current.cacheScope !== snapshot.cacheScope;
	const revisionChanged =
		current.businessId === snapshot.businessId &&
		Boolean(current.revision) &&
		current.revision !== snapshot.revision;
	if (identityChanged) invalidatePatientListCache();
	else if (revisionChanged) invalidatePatientListCache(snapshot.cacheScope);

	patientRevisionState.set({
		businessId: snapshot.businessId,
		cacheScope: snapshot.cacheScope,
		revision: snapshot.revision,
		status: 'verified',
		lastVerifiedAt: Date.now()
	});
	return true;
};

export const acceptPatientListSnapshot = (data: PatientListSnapshot) => {
	if (!data.businessId) return !data.cacheable;
	return acceptVerifiedPatientRevision({
		businessId: data.businessId,
		cacheable: data.cacheable,
		revision: data.revision,
		cacheScope: data.cacheScope
	});
};

export const isPatientListSnapshotCurrent = (
	data: PatientListSnapshot,
	state = get(patientRevisionState)
) =>
	!data.cacheable ||
	(state.status === 'verified' &&
		state.businessId === data.businessId &&
		state.cacheScope === data.cacheScope &&
		state.revision === data.revision);

export const getCurrentVerifiedPatientRevision = (
	businessId: string,
	now = Date.now()
): { cacheScope: string; revision: string } | null => {
	const state = get(patientRevisionState);
	if (
		state.status !== 'verified' ||
		state.businessId !== businessId ||
		!state.cacheScope ||
		!state.revision ||
		now - state.lastVerifiedAt > PATIENT_REVISION_VERIFICATION_MAX_AGE_MS
	) {
		return null;
	}
	return { cacheScope: state.cacheScope, revision: state.revision };
};

export const markPatientRevisionUnverified = (businessId?: string | null) => {
	const current = get(patientRevisionState);
	if (businessId && current.businessId && current.businessId !== businessId) return;
	if (current.status === 'disabled') return;
	invalidatePatientListCache(current.cacheScope);
	patientRevisionState.set({ ...current, status: 'unverified', lastVerifiedAt: 0 });
};

export const observePatientRevisionEvent = (businessId: string, revisionValue: unknown) => {
	const revision = normalizeRevision(revisionValue);
	const current = get(patientRevisionState);
	if (!revision || current.businessId !== businessId || current.status === 'disabled') return false;
	if (current.revision && compareRevisions(revision, current.revision) <= 0) return false;
	invalidatePatientListCache(current.cacheScope);
	patientRevisionState.set({
		...current,
		revision,
		status: 'unverified',
		lastVerifiedAt: 0
	});
	return true;
};

export const verifyPatientRevision = async (
	fetcher: typeof globalThis.fetch,
	businessId: string
): Promise<PatientRevisionSnapshot> => {
	const existing = verificationInFlight.get(businessId);
	if (existing) return existing;

	const request = (async () => {
		const response = await fetcher(
			`/odonto/pacientes/revision?business_id=${encodeURIComponent(businessId)}`,
			{
			headers: { accept: 'application/json' },
			cache: 'no-store'
			}
		);
		let payload: unknown = null;
		try {
			payload = await response.json();
		} catch {
			payload = null;
		}
		if (!response.ok) {
			const message = String((payload as { message?: unknown } | null)?.message ?? '').trim();
			throw new Error(message || 'No pudimos verificar la lista de pacientes.');
		}
		const snapshot = parseRevisionSnapshot(payload);
		if (snapshot.businessId !== businessId || !acceptVerifiedPatientRevision(snapshot)) {
			throw new Error('La lista de pacientes está cambiando. Esperá un momento.');
		}
		return snapshot;
	})();

	verificationInFlight.set(businessId, request);
	try {
		return await request;
	} catch (error) {
		markPatientRevisionUnverified(businessId);
		throw error;
	} finally {
		if (verificationInFlight.get(businessId) === request) {
			verificationInFlight.delete(businessId);
		}
	}
};

export const resetPatientListClientState = () => {
	patientListCache.clear();
	verificationInFlight.clear();
	patientListNavigationContext = null;
	patientRevisionState.set(initialRevisionState());
};

export const rememberPatientListNavigation = ({
	businessId,
	showArchived,
	query,
	loadedCount,
	scrollY,
	now = Date.now()
}: {
	businessId: string;
	showArchived: boolean;
	query: string;
	loadedCount: number;
	scrollY: number;
	now?: number;
}) => {
	if (typeof window === 'undefined' || !businessId) return;
	patientListNavigationContext = {
		businessId,
		showArchived,
		query: normalizeQuery(query),
		loadedCount: Math.max(0, Math.floor(loadedCount)),
		scrollY: Math.max(0, Math.floor(scrollY)),
		expiresAt: now + NAVIGATION_CONTEXT_TTL_MS
	};
};

export const consumePatientListNavigation = ({
	businessId,
	showArchived,
	query,
	now = Date.now()
}: {
	businessId: string;
	showArchived: boolean;
	query: string;
	now?: number;
}) => {
	if (typeof window === 'undefined') return null;
	const context = patientListNavigationContext;
	patientListNavigationContext = null;
	if (
		!context ||
		context.expiresAt <= now ||
		context.businessId !== businessId ||
		context.showArchived !== showArchived ||
		context.query !== normalizeQuery(query)
	) {
		return null;
	}
	return { loadedCount: context.loadedCount, scrollY: context.scrollY };
};

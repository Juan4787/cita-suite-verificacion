const DAY_MS = 24 * 60 * 60 * 1000;

type StoredDraft<T> = {
	savedAt: number;
	data: T;
};

export const DRAFT_TTL_MS = DAY_MS;

export const loadTtlDraft = <T>(key: string, ttlMs = DRAFT_TTL_MS): T | null => {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredDraft<T>;
		if (!parsed || typeof parsed.savedAt !== 'number' || !('data' in parsed)) {
			localStorage.removeItem(key);
			return null;
		}
		if (Date.now() - parsed.savedAt > ttlMs) {
			localStorage.removeItem(key);
			return null;
		}
		return parsed.data;
	} catch {
		try {
			localStorage.removeItem(key);
		} catch {
			/* localStorage unavailable */
		}
		return null;
	}
};

export const saveTtlDraft = <T>(key: string, data: T) => {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data } satisfies StoredDraft<T>));
	} catch {
		/* quota or localStorage unavailable */
	}
};

export const clearTtlDraft = (key: string) => {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(key);
	} catch {
		/* localStorage unavailable */
	}
};

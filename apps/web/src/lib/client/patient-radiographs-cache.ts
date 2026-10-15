export type PatientRadiographItem = {
 source?:'professional'|'patient'; appointment_id?:string|null;
	id: string;
	patient_id?: string;
	status?: 'uploading' | 'ready' | 'failed' | 'trashed' | string;
	original_filename?: string | null;
	mime_type?: string | null;
	bytes?: number | null;
	taken_at?: string | null;
	note?: string | null;
	created_at?: string | null;
	ready_at?: string | null;
	integrity_status?: string | null;
	thumbnail_url?: string | null;
	is_mine?: boolean;
};

export type PatientRadiographPage = {
	items: PatientRadiographItem[];
	has_more: boolean;
	next_cursor: string | null;
};

type PageCacheEntry = {
	value?: PatientRadiographPage;
	promise?: Promise<PatientRadiographPage>;
};

type OriginalRequest = {
	controller: AbortController;
	promise: Promise<string>;
};

type PatientCache = {
	pages: Map<string, PageCacheEntry>;
	thumbnailUrls: Map<string, string>;
	thumbnailRequests: Map<string, Promise<void>>;
	originalUrls: Map<string, string>;
	originalRequests: Map<string, OriginalRequest>;
	backgroundControllers: Set<AbortController>;
};

type IdleWindow = Window &
	typeof globalThis & {
		requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
		cancelIdleCallback?: (handle: number) => void;
	};

type ScheduledTask = {
	cancel: () => void;
};

const FIRST_PAGE_KEY = '__first__';
const THUMBNAIL_PRELOAD_CONCURRENCY = 2;
const caches = new Map<string, PatientCache>();
let activeCacheScope: string | null = null;
let inactiveCleanup: ScheduledTask | null = null;

const scheduleAfterPaint = (callback: () => void): ScheduledTask => {
	if (typeof window.requestAnimationFrame !== 'function') {
		const handle = window.setTimeout(callback, 0);
		return { cancel: () => window.clearTimeout(handle) };
	}
	let timeoutHandle: number | null = null;
	const frameHandle = window.requestAnimationFrame(() => {
		timeoutHandle = window.setTimeout(callback, 0);
	});
	return {
		cancel: () => {
			window.cancelAnimationFrame(frameHandle);
			if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
		}
	};
};

const createPatientCache = (): PatientCache => ({
	pages: new Map(),
	thumbnailUrls: new Map(),
	thumbnailRequests: new Map(),
	originalUrls: new Map(),
	originalRequests: new Map(),
	backgroundControllers: new Set()
});

const getPatientCache = (cacheScope: string) => {
	let cache = caches.get(cacheScope);
	if (!cache) {
		cache = createPatientCache();
		caches.set(cacheScope, cache);
	}
	return cache;
};

const pageKey = (cursor: string | null) => cursor || FIRST_PAGE_KEY;

const scheduleAfterNavigation = (callback: () => void): ScheduledTask => {
	if (typeof window === 'undefined') return { cancel: () => {} };
	const idleWindow = window as IdleWindow;
	if (typeof idleWindow.requestIdleCallback === 'function') {
		const handle = idleWindow.requestIdleCallback(callback, { timeout: 2_000 });
		return { cancel: () => idleWindow.cancelIdleCallback?.(handle) };
	}

	return scheduleAfterPaint(callback);
};

const scheduleBackgroundStart = (callback: () => void): ScheduledTask => {
	if (typeof window === 'undefined') return { cancel: () => {} };
	const idleWindow = window as IdleWindow;
	if (typeof idleWindow.requestIdleCallback === 'function') {
		const handle = idleWindow.requestIdleCallback(callback, { timeout: 1_000 });
		return { cancel: () => idleWindow.cancelIdleCallback?.(handle) };
	}

	return scheduleAfterPaint(callback);
};

const revokeObjectUrl = (url: string) => {
	if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
		URL.revokeObjectURL(url);
	}
};

const releasePatientCache = (cacheScope: string, cache: PatientCache) => {
	for (const controller of cache.backgroundControllers) controller.abort();
	for (const request of cache.originalRequests.values()) request.controller.abort();
	for (const url of cache.thumbnailUrls.values()) revokeObjectUrl(url);
	for (const url of cache.originalUrls.values()) revokeObjectUrl(url);
	cache.pages.clear();
	cache.thumbnailUrls.clear();
	cache.thumbnailRequests.clear();
	cache.originalUrls.clear();
	cache.originalRequests.clear();
	cache.backgroundControllers.clear();
	caches.delete(cacheScope);
};

const releaseInactivePatientCaches = () => {
	inactiveCleanup = null;
	for (const [cacheScope, cache] of caches) {
		if (cacheScope !== activeCacheScope) releasePatientCache(cacheScope, cache);
	}
};

/**
 * Keeps one patient's clinical images in memory. Switching patients only schedules
 * the previous cache for cleanup, so navigation and the first render stay untouched.
 */
export const activatePatientRadiographCache = (cacheScope: string) => {
	if (typeof window === 'undefined' || !cacheScope || activeCacheScope === cacheScope) return;
	activeCacheScope = cacheScope;
	getPatientCache(cacheScope);
	inactiveCleanup?.cancel();
	inactiveCleanup = scheduleAfterNavigation(releaseInactivePatientCaches);
};

export const invalidatePatientRadiographListing = (cacheScope: string) => {
	const cache = caches.get(cacheScope);
	if (!cache) return;
	for (const controller of cache.backgroundControllers) controller.abort();
	cache.backgroundControllers.clear();
	cache.pages.clear();
};

export const removePatientRadiographFromCache = (cacheScope: string, radiographId: string) => {
	const cache = caches.get(cacheScope);
	if (!cache) return;
	for (const controller of cache.backgroundControllers) controller.abort();
	cache.backgroundControllers.clear();
	cache.pages.clear();
	const thumbnailUrl = cache.thumbnailUrls.get(radiographId);
	if (thumbnailUrl) revokeObjectUrl(thumbnailUrl);
	cache.thumbnailUrls.delete(radiographId);
	const originalUrl = cache.originalUrls.get(radiographId);
	if (originalUrl) revokeObjectUrl(originalUrl);
	cache.originalUrls.delete(radiographId);
	const originalRequest = cache.originalRequests.get(radiographId);
	if (originalRequest) originalRequest.controller.abort();
	cache.originalRequests.delete(radiographId);
};

const parseRadiographPage = (value: unknown): PatientRadiographPage => {
	const payload = (value ?? {}) as Record<string, unknown>;
	return {
		items: Array.isArray(payload.items)
			? payload.items.filter(
					(item): item is PatientRadiographItem =>
						Boolean(item) && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
			  )
			: [],
		has_more: payload.has_more === true,
		next_cursor: typeof payload.next_cursor === 'string' && payload.next_cursor ? payload.next_cursor : null
	};
};

const materializeThumbnailUrls = (cache: PatientCache, page: PatientRadiographPage) => ({
	...page,
	items: page.items.map((item) => ({
		...item,
		thumbnail_url: cache.thumbnailUrls.get(item.id) ?? item.thumbnail_url ?? null
	}))
});

export const loadPatientRadiographPage = async ({
	cacheScope,
	endpoint,
	cursor = null,
	signal,
	lowPriority = false,
	fetcher = globalThis.fetch
}: {
	cacheScope: string;
	endpoint: string;
	cursor?: string | null;
	signal?: AbortSignal;
	lowPriority?: boolean;
	fetcher?: typeof globalThis.fetch;
}): Promise<PatientRadiographPage> => {
	const cache = getPatientCache(cacheScope);
	const key = pageKey(cursor);
	const existing = cache.pages.get(key);
	if (existing?.value) return materializeThumbnailUrls(cache, existing.value);
	if (existing?.promise) return existing.promise;

	const entry: PageCacheEntry = existing ?? {};
	const requestUrl = cursor ? `${endpoint}?cursor=${encodeURIComponent(cursor)}` : endpoint;
	const request = fetcher(
		requestUrl,
		lowPriority
			? ({ signal, priority: 'low' } as RequestInit)
			: { signal }
	)
		.then(async (response) => {
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				const message = String(
					(payload as { message?: unknown }).message ??
						'No pudimos cargar las imágenes. Probá de nuevo.'
				);
				throw new Error(message);
			}
			const page = parseRadiographPage(payload);
			entry.value = page;
			return materializeThumbnailUrls(cache, page);
		})
		.finally(() => {
			if (entry.promise === request) entry.promise = undefined;
		});

	entry.promise = request;
	cache.pages.set(key, entry);
	return request;
};

const preloadThumbnail = ({
	cacheScope,
	cache,
	item,
	signal,
	fetcher
}: {
	cacheScope: string;
	cache: PatientCache;
	item: PatientRadiographItem;
	signal: AbortSignal;
	fetcher: typeof globalThis.fetch;
}) => {
	if (!item.thumbnail_url || cache.thumbnailUrls.has(item.id)) return Promise.resolve();
	const existing = cache.thumbnailRequests.get(item.id);
	if (existing) return existing;
	const sourceUrl = item.thumbnail_url;
	const request = fetcher(
		sourceUrl,
		({
			signal,
			credentials: 'omit',
			cache: 'force-cache',
			priority: 'low',
			referrerPolicy: 'no-referrer'
		} as RequestInit)
	)
		.then(async (response) => {
			if (!response.ok) return;
			const blob = await response.blob();
			if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) return;
			if (signal.aborted || caches.get(cacheScope) !== cache) return;
			if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
			const objectUrl = URL.createObjectURL(blob);
			if (signal.aborted || caches.get(cacheScope) !== cache) {
				revokeObjectUrl(objectUrl);
				return;
			}
			const previousUrl = cache.thumbnailUrls.get(item.id);
			if (previousUrl) revokeObjectUrl(previousUrl);
			cache.thumbnailUrls.set(item.id, objectUrl);
		})
		.catch((error) => {
			if (!signal.aborted && (error as { name?: string })?.name !== 'AbortError') {
				// La miniatura seguirá usando su URL firmada; el listado no debe fallar por esta optimización.
			}
		})
		.finally(() => {
			if (cache.thumbnailRequests.get(item.id) === request) {
				cache.thumbnailRequests.delete(item.id);
			}
		});
	cache.thumbnailRequests.set(item.id, request);
	return request;
};

const preloadPageThumbnails = async ({
	cacheScope,
	page,
	signal,
	fetcher
}: {
	cacheScope: string;
	page: PatientRadiographPage;
	signal: AbortSignal;
	fetcher: typeof globalThis.fetch;
}) => {
	const cache = getPatientCache(cacheScope);
	const pending = page.items.filter(
		(item) => Boolean(item.thumbnail_url) && !cache.thumbnailUrls.has(item.id)
	);
	let nextIndex = 0;
	const worker = async () => {
		while (!signal.aborted && nextIndex < pending.length) {
			const item = pending[nextIndex++];
			await preloadThumbnail({ cacheScope, cache, item, signal, fetcher });
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(THUMBNAIL_PRELOAD_CONCURRENCY, pending.length) },
			() => worker()
		)
	);
};

export const preloadPatientRadiographs = async ({
	cacheScope,
	endpoint,
	signal,
	fetcher = globalThis.fetch
}: {
	cacheScope: string;
	endpoint: string;
	signal: AbortSignal;
	fetcher?: typeof globalThis.fetch;
}) => {
	let cursor: string | null = null;
	const visitedCursors = new Set<string>();
	do {
		if (signal.aborted) return;
		const page = await loadPatientRadiographPage({
			cacheScope,
			endpoint,
			cursor,
			signal,
			lowPriority: true,
			fetcher
		});
		await preloadPageThumbnails({ cacheScope, page, signal, fetcher });
		if (!page.has_more || !page.next_cursor || visitedCursors.has(page.next_cursor)) return;
		visitedCursors.add(page.next_cursor);
		cursor = page.next_cursor;
	} while (!signal.aborted);
};

/**
 * Starts metadata and thumbnail work only when the browser is idle. Cancelling it
 * aborts speculative work without touching originals the user already opened.
 */
export const schedulePatientRadiographPreload = ({
	cacheScope,
	endpoint,
	fetcher = globalThis.fetch
}: {
	cacheScope: string;
	endpoint: string;
	fetcher?: typeof globalThis.fetch;
}) => {
	if (typeof window === 'undefined') return () => {};
	const cache = getPatientCache(cacheScope);
	cache.pages.clear();
	const controller = new AbortController();
	cache.backgroundControllers.add(controller);
	const scheduled = scheduleBackgroundStart(() => {
		void preloadPatientRadiographs({
			cacheScope,
			endpoint,
			signal: controller.signal,
			fetcher
		})
			.catch(() => {
				// Es una mejora de mejor esfuerzo: la sección conserva su carga y error habituales.
			})
			.finally(() => cache.backgroundControllers.delete(controller));
	});

	return () => {
		scheduled.cancel();
		controller.abort();
		cache.backgroundControllers.delete(controller);
	};
};

export const getCachedPatientRadiographOriginal = (
	cacheScope: string,
	radiographId: string
) => caches.get(cacheScope)?.originalUrls.get(radiographId) ?? null;

/**
 * Original files enter this cache only through an explicit viewer open. The
 * caller owns the authorized download; this helper only deduplicates and retains it.
 */
export const getOrLoadPatientRadiographOriginal = ({
	cacheScope,
	radiographId,
	load
}: {
	cacheScope: string;
	radiographId: string;
	load: (signal: AbortSignal) => Promise<Blob>;
}) => {
	const cache = getPatientCache(cacheScope);
	const cached = cache.originalUrls.get(radiographId);
	if (cached) return Promise.resolve(cached);
	const existing = cache.originalRequests.get(radiographId);
	if (existing) return existing.promise;

	const controller = new AbortController();
	const request: OriginalRequest = {
		controller,
		promise: Promise.resolve('')
	};
	request.promise = load(controller.signal)
		.then((blob) => {
			if (!blob.size) throw new Error('No pudimos descargar la imagen. Probá de nuevo.');
			if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
			if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
				throw new Error('No pudimos preparar la imagen para verla. Probá de nuevo.');
			}
			const objectUrl = URL.createObjectURL(blob);
			if (controller.signal.aborted || caches.get(cacheScope) !== cache) {
				revokeObjectUrl(objectUrl);
				throw new DOMException('Aborted', 'AbortError');
			}
			cache.originalUrls.set(radiographId, objectUrl);
			return objectUrl;
		})
		.finally(() => {
			if (cache.originalRequests.get(radiographId) === request) {
				cache.originalRequests.delete(radiographId);
			}
		});
	cache.originalRequests.set(radiographId, request);
	return request.promise;
};

export const resetPatientRadiographCacheForTests = () => {
	inactiveCleanup?.cancel();
	inactiveCleanup = null;
	for (const [cacheScope, cache] of caches) releasePatientCache(cacheScope, cache);
	activeCacheScope = null;
};

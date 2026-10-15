/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	activatePatientRadiographCache,
	getCachedPatientRadiographOriginal,
	getOrLoadPatientRadiographOriginal,
	loadPatientRadiographPage,
	preloadPatientRadiographs,
	resetPatientRadiographCacheForTests,
	schedulePatientRadiographPreload
} from './patient-radiographs-cache';

const endpoint = '/odonto/pacientes/patient-a/radiografias';
const scopeA = 'user-1:patient-a:live:view';
const scopeB = 'user-1:patient-b:live:view';

const response = ({
	json,
	blob,
	ok = true
}: {
	json?: unknown;
	blob?: Blob;
	ok?: boolean;
}) =>
	({
		ok,
		json: async () => json ?? {},
		blob: async () => blob ?? new Blob()
	}) as Response;

describe('patient radiograph memory cache', () => {
	let objectUrlSequence = 0;
	let createObjectURL: ReturnType<typeof vi.fn>;
	let revokeObjectURL: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		objectUrlSequence = 0;
		createObjectURL = vi.fn(() => `blob:clinical-${++objectUrlSequence}`);
		revokeObjectURL = vi.fn();
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value: createObjectURL
		});
		Object.defineProperty(URL, 'revokeObjectURL', {
			configurable: true,
			value: revokeObjectURL
		});
		resetPatientRadiographCacheForTests();
	});

	afterEach(() => {
		resetPatientRadiographCacheForTests();
		vi.useRealTimers();
	});

	it('preloads every metadata page and every thumbnail without requesting an original', async () => {
		activatePatientRadiographCache(scopeA);
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === endpoint) {
				return response({
					json: {
						items: [
							{ id: 'radiograph-1', thumbnail_url: 'https://storage/thumb-1' },
							{ id: 'radiograph-2', thumbnail_url: 'https://storage/thumb-2' }
						],
						has_more: true,
						next_cursor: 'next-page'
					}
				});
			}
			if (url === `${endpoint}?cursor=next-page`) {
				return response({
					json: {
						items: [{ id: 'radiograph-3', thumbnail_url: 'https://storage/thumb-3' }],
						has_more: false,
						next_cursor: null
					}
				});
			}
			if (url.startsWith('https://storage/thumb-')) {
				expect(init).toMatchObject({
					credentials: 'omit',
					cache: 'force-cache',
					priority: 'low'
				});
				return response({ blob: new Blob(['thumbnail'], { type: 'image/webp' }) });
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		const fetcher = fetchMock as unknown as typeof fetch;

		await preloadPatientRadiographs({
			cacheScope: scopeA,
			endpoint,
			signal: new AbortController().signal,
			fetcher
		});

		expect(fetchMock).toHaveBeenCalledTimes(5);
		expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
			expect.arrayContaining([
				endpoint,
				`${endpoint}?cursor=next-page`,
				'https://storage/thumb-1',
				'https://storage/thumb-2',
				'https://storage/thumb-3'
			])
		);
		expect(fetchMock.mock.calls.some(([input]) => String(input).includes('access-grants'))).toBe(
			false
		);

		const firstPage = await loadPatientRadiographPage({
			cacheScope: scopeA,
			endpoint,
			fetcher
		});
		expect(firstPage.items.map((item) => item.thumbnail_url)).toEqual([
			'blob:clinical-1',
			'blob:clinical-2'
		]);
		expect(fetchMock).toHaveBeenCalledTimes(5);
	});

	it('keeps every explicitly opened original and never runs its loader twice', async () => {
		activatePatientRadiographCache(scopeA);
		const loadFirst = vi.fn(async () => new Blob(['original-1'], { type: 'image/jpeg' }));
		const loadSecond = vi.fn(async () => new Blob(['original-2'], { type: 'image/png' }));

		const firstUrl = await getOrLoadPatientRadiographOriginal({
			cacheScope: scopeA,
			radiographId: 'radiograph-1',
			load: loadFirst
		});
		const repeatedUrl = await getOrLoadPatientRadiographOriginal({
			cacheScope: scopeA,
			radiographId: 'radiograph-1',
			load: loadFirst
		});
		const secondUrl = await getOrLoadPatientRadiographOriginal({
			cacheScope: scopeA,
			radiographId: 'radiograph-2',
			load: loadSecond
		});

		expect(firstUrl).toBe('blob:clinical-1');
		expect(repeatedUrl).toBe(firstUrl);
		expect(secondUrl).toBe('blob:clinical-2');
		expect(loadFirst).toHaveBeenCalledTimes(1);
		expect(loadSecond).toHaveBeenCalledTimes(1);
		expect(getCachedPatientRadiographOriginal(scopeA, 'radiograph-1')).toBe(firstUrl);
		expect(getCachedPatientRadiographOriginal(scopeA, 'radiograph-2')).toBe(secondUrl);
	});

	it('retains the last patient away from the profile and releases it after another patient opens', async () => {
		activatePatientRadiographCache(scopeA);
		const originalUrl = await getOrLoadPatientRadiographOriginal({
			cacheScope: scopeA,
			radiographId: 'radiograph-1',
			load: async () => new Blob(['original'], { type: 'image/jpeg' })
		});

		// No deactivation happens when navigating to Agenda, so returning to A is an immediate hit.
		activatePatientRadiographCache(scopeA);
		expect(getCachedPatientRadiographOriginal(scopeA, 'radiograph-1')).toBe(originalUrl);

		activatePatientRadiographCache(scopeB);
		expect(getCachedPatientRadiographOriginal(scopeA, 'radiograph-1')).toBe(originalUrl);
		expect(revokeObjectURL).not.toHaveBeenCalled();

		await vi.runAllTimersAsync();
		expect(getCachedPatientRadiographOriginal(scopeA, 'radiograph-1')).toBeNull();
		expect(revokeObjectURL).toHaveBeenCalledWith(originalUrl);
	});

	it('does not start or continue speculative listing work after leaving the profile', async () => {
		activatePatientRadiographCache(scopeA);
		const fetcher = vi.fn(async () =>
			response({ json: { items: [], has_more: false, next_cursor: null } })
		) as unknown as typeof fetch;
		const cancel = schedulePatientRadiographPreload({ cacheScope: scopeA, endpoint, fetcher });

		expect(fetcher).not.toHaveBeenCalled();
		cancel();
		await vi.runAllTimersAsync();
		expect(fetcher).not.toHaveBeenCalled();
	});
});

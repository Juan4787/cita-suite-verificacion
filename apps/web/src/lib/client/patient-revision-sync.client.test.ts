import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const mocks = vi.hoisted(() => ({ verifyPatientRevision: vi.fn() }));

// Without Realtime settings the sync runs on its HTTP fallback: the degraded mode in
// which an open tab could become a steady stream of requests.
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$lib/client/patient-list-cache', () => ({
	markPatientRevisionUnverified: vi.fn(),
	observePatientRevisionEvent: vi.fn(() => false),
	patientRevisionState: writable({ businessId: '', revision: '', cacheScope: '', status: 'unverified' }),
	verifyPatientRevision: mocks.verifyPatientRevision
}));

const { startPatientRevisionSync } = await import('./patient-revision-sync');

let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (state: DocumentVisibilityState) => {
	visibility = state;
	document.dispatchEvent(new Event('visibilitychange'));
};

describe('patient revision sync without Realtime', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		visibility = 'visible';
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
		mocks.verifyPatientRevision.mockReset();
		mocks.verifyPatientRevision.mockResolvedValue({ cacheable: false, topic: null });
	});
	afterEach(() => vi.useRealTimers());

	it('checks a hidden tab not at all and a visible one less often the longer Realtime stays away', async () => {
		const stop = startPatientRevisionSync({ businessId: 'business-1', onRevisionChanged: vi.fn() });
		await vi.advanceTimersByTimeAsync(0);
		const initial = mocks.verifyPatientRevision.mock.calls.length;
		expect(initial).toBe(1);

		// Hidden for five minutes: no request at all.
		setVisibility('hidden');
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(mocks.verifyPatientRevision.mock.calls.length).toBe(initial);

		// Back in view: one check right away.
		setVisibility('visible');
		await vi.advanceTimersByTimeAsync(0);
		const returned = mocks.verifyPatientRevision.mock.calls.length;
		expect(returned).toBe(initial + 1);

		// Visible for five minutes without Realtime: bounded, far from one check every five seconds.
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		const visibleChecks = mocks.verifyPatientRevision.mock.calls.length - returned;
		expect(visibleChecks).toBeGreaterThan(0);
		expect(visibleChecks).toBeLessThanOrEqual(25);
		stop();

		// Stopped: nothing more.
		const stopped = mocks.verifyPatientRevision.mock.calls.length;
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(mocks.verifyPatientRevision.mock.calls.length).toBe(stopped);
	});
});

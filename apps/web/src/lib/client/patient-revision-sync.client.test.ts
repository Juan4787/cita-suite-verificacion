import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const mocks = vi.hoisted(() => ({
	verifyPatientRevision: vi.fn(),
	env: {} as Record<string, string>,
	channelStatus: null as ((status: string) => void) | null
}));

// Without Realtime settings (the default here) the sync runs on its HTTP fallback, and
// with them a failing channel reports errors: the degraded modes in which an open tab
// could become a steady stream of requests.
vi.mock('$env/dynamic/public', () => ({ env: mocks.env }));
vi.mock('$lib/client/patient-list-cache', () => ({
	markPatientRevisionUnverified: vi.fn(),
	observePatientRevisionEvent: vi.fn(() => false),
	patientRevisionState: writable({ businessId: '', revision: '', cacheScope: '', status: 'unverified' }),
	verifyPatientRevision: mocks.verifyPatientRevision
}));
// A Realtime client whose channel reports whatever status the test sets.
vi.mock('@supabase/supabase-js', () => {
	const channel = {
		on: () => channel,
		subscribe: (callback: (status: string) => void) => {
			mocks.channelStatus = callback;
			return channel;
		}
	};
	return {
		createClient: () => ({
			realtime: { setAuth: async () => {} },
			channel: () => channel,
			removeChannel: async () => 'ok',
			removeAllChannels: async () => []
		})
	};
});

const { startPatientRevisionSync } = await import('./patient-revision-sync');

let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (state: DocumentVisibilityState) => {
	visibility = state;
	document.dispatchEvent(new Event('visibilitychange'));
};
const checks = () => mocks.verifyPatientRevision.mock.calls.length;

describe('patient revision sync with Realtime missing or failing', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		visibility = 'visible';
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
		for (const key of Object.keys(mocks.env)) delete mocks.env[key];
		mocks.channelStatus = null;
		mocks.verifyPatientRevision.mockReset();
		mocks.verifyPatientRevision.mockResolvedValue({ cacheable: false, topic: null });
	});
	afterEach(() => vi.useRealTimers());

	it('checks a hidden tab not at all and a visible one less often the longer Realtime stays away', async () => {
		const stop = startPatientRevisionSync({ businessId: 'business-1', onRevisionChanged: vi.fn() });
		await vi.advanceTimersByTimeAsync(0);
		const initial = checks();
		expect(initial).toBe(1);

		// Hidden for five minutes: no request at all.
		setVisibility('hidden');
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(checks()).toBe(initial);

		// Back in view: one check right away.
		setVisibility('visible');
		await vi.advanceTimersByTimeAsync(0);
		const returned = checks();
		expect(returned).toBe(initial + 1);

		// Visible for five minutes without Realtime: bounded, far from one check every five seconds.
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		const visibleChecks = checks() - returned;
		expect(visibleChecks).toBeGreaterThan(0);
		expect(visibleChecks).toBeLessThanOrEqual(25);
		stop();

		// Stopped: nothing more.
		const stopped = checks();
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(checks()).toBe(stopped);
	});

	it('checks once when Realtime drops, not on every failed reconnection, and not at all while hidden', async () => {
		mocks.env.PUBLIC_ODONTO_SUPABASE_URL = 'https://realtime.example.test';
		mocks.env.PUBLIC_ODONTO_SUPABASE_ANON_KEY = 'anon-key';
		mocks.verifyPatientRevision.mockResolvedValue({ cacheable: true, topic: 'patients:business-1' });
		const stop = startPatientRevisionSync({ businessId: 'business-1', onRevisionChanged: vi.fn() });
		await vi.advanceTimersByTimeAsync(0);
		const reportStatus = mocks.channelStatus;
		if (!reportStatus) throw new Error('the sync never subscribed to its Realtime channel');
		reportStatus('SUBSCRIBED');
		await vi.advanceTimersByTimeAsync(0);
		const live = checks();

		// Realtime goes away and its client retries every ten seconds for five minutes.
		for (let attempt = 0; attempt < 30; attempt++) {
			reportStatus('CHANNEL_ERROR');
			await vi.advanceTimersByTimeAsync(10_000);
		}
		const visibleChecks = checks() - live;
		expect(visibleChecks).toBeGreaterThan(0);
		expect(visibleChecks).toBeLessThanOrEqual(25);

		// Hidden, with Realtime still failing: no request at all.
		setVisibility('hidden');
		const hidden = checks();
		for (let attempt = 0; attempt < 30; attempt++) {
			reportStatus('CHANNEL_ERROR');
			await vi.advanceTimersByTimeAsync(10_000);
		}
		expect(checks()).toBe(hidden);
		stop();
	});
});

import { expect, type Page, type TestInfo } from '@playwright/test';
import { fixtureRealtimeDiagnostic } from './realtime-diagnostics';
import { safeBrowserText } from '../../../../scripts/lib/browser-evidence.mjs';
declare global {
	interface Window {
		__citaFixtureSocketClose: (readyState: number) => Promise<void>;
		__citaFixtureSocketCloseInstalled?: boolean;
	}
}
type Failure = { status: number; method: string; path: string };
// What each engine calls a load that the page itself dropped, for example by leaving: measured on all three.
const DROPPED_LOADS = new Set(['net::ERR_ABORTED', 'NS_BINDING_ABORTED', 'Load request cancelled']);
// A fetch or import still running when a page is left is a page error for Firefox and WebKit; Chromium says nothing.
// WebKit refuses a fetch that starts while its document is going away, words it as an access check and reports no
// request, so there is no dropped load to match. The policy allows 'self': for the page's own origin nothing else refuses it.
const refusedWhileLeaving = (error: Error, page: Page) =>
	error.name === 'Fetch API cannot load http' &&
	error.message.startsWith(`/${new URL(page.url()).host}/`) &&
	error.message.endsWith(' due to access control checks.');
// A capture makes Playwright insert a style, and WebKit, only WebKit, applies the page's policy to it: one refusal per frame.
const CAPTURE_STYLE_REFUSAL = /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/;
const LEFT_PAGE_ERROR = /^NetworkError when attempting to fetch resource\.$|^error loading dynamically imported module: |^(?:Error: )?Unable to preload CSS for |Load failed$|Importing a module script failed\.$| due to access control checks\.$/;

/** The page errors that mean something: each one caused by leaving must match a load the engine reports as dropped. */
export function pageErrorCollector() {
	const errors: string[] = [];
	let dropped = 0;
	return {
		watch(page: Page) {
			page.on('pageerror', (error) => {
				if (!refusedWhileLeaving(error, page)) errors.push(error.message);
			});
			page.on('requestfailed', (request) => {
				if (DROPPED_LOADS.has(request.failure()?.errorText ?? '')) dropped++;
			});
		},
		unexpected() {
			const left = errors.filter((message) => LEFT_PAGE_ERROR.test(message));
			return [...errors.filter((message) => !LEFT_PAGE_ERROR.test(message)), ...left.slice(dropped)];
		}
	};
}

export async function observeRenderHealth(
	page: Page,
	allowResponse: (failure: Failure) => boolean = () => false,
	expectedFailureCount = 0
) {
	const messages: { type: string; category: string; source: string; line: number; sample?: string }[] = [];
	const failedResponses: Failure[] = [],
		networkFailures: { path: string; code: string }[] = [];
	let overflow = false;
	let capturing = 0;
	const duringCapture = async <T>(take: () => Promise<T>) => {
		capturing++;
		try {
			return await take();
		} finally {
			capturing--;
		}
	};
	const screenshot = page.screenshot.bind(page);
	page.screenshot = (options) => duringCapture(() => screenshot(options));
	const socketCloseStates = [0, 0, 0, 0];
	// Observe the native close call without changing its arguments, result or network.
	// A known cancellation message alone is insufficient: a fixture socket must
	// actually have been closed while CONNECTING during this very browser run.
	if (process.env.CITA_E2E_ENVIRONMENT === 'disposable') {
		const api = new URL(process.env.PUBLIC_ODONTO_SUPABASE_URL ?? '');
		if (api.hostname !== '127.0.0.1' || api.protocol !== 'http:') throw new Error('The socket probe needs the owned loopback fixture.');
		await page.exposeFunction('__citaFixtureSocketClose', (state: number) => {
			if (!Number.isInteger(state) || state < 0 || state > 3) throw new Error('Invalid socket lifecycle metadata.');
			socketCloseStates[state]++;
		});
		const installSocketCloseProbe = (apiOrigin: string) => {
			if (window.__citaFixtureSocketCloseInstalled) return;
			window.__citaFixtureSocketCloseInstalled = true;
			const api = new URL(apiOrigin);
			const close = WebSocket.prototype.close;
			WebSocket.prototype.close = function (this: WebSocket, code?: number, reason?: string) {
				const target = new URL(this.url);
				if (target.protocol === 'ws:' && target.host === api.host && target.pathname === '/realtime/v1/websocket')
					void window.__citaFixtureSocketClose(this.readyState).catch(() => {});
				return close.call(this, code, reason);
			};
		};
		await page.addInitScript(installSocketCloseProbe, api.origin);
		// addInitScript covers future documents only. A caller can already be on
		// a loaded page whose cleanup will close a socket on the next navigation.
		await page.evaluate(installSocketCloseProbe, api.origin);
	}
	// Firefox also reports the rejected handshake of a socket as a response; the fixture has no Realtime server.
	const fixtureRealtimeHandshake = (raw: string) => {
		if (process.env.CITA_E2E_ENVIRONMENT !== 'disposable') return false;
		const target = new URL(raw);
		return target.host === new URL(process.env.PUBLIC_ODONTO_SUPABASE_URL ?? '').host && target.pathname === '/realtime/v1/websocket';
	};
	const safePath = (raw: string) => {
		try {
			return new URL(raw).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');
		} catch {
			return 'unknown';
		}
	};
	page.on('console', (message) => {
		const type = message.type();
		if (type !== 'error' && type !== 'warning') return;
		const text = message.text();
		// Only during a capture: a style of the app refused at any other moment still counts.
		if (capturing && CAPTURE_STYLE_REFUSAL.test(text)) return;
		if (messages.length >= 100) {
			overflow = true;
			return;
		}
		const category = text.startsWith('Failed to load resource:')
			? 'resource-failure'
			// Firefox also words a dropped load this way. A load that really fails stays in networkFailures.
			: /^\[JavaScript Warning: "Loading failed for the (<script>|module) with source /.test(text) ||
					/^\[JavaScript Error: "downloadable font: download failed .*status=2152398850/.test(text) ||
					/^\[JavaScript Error: "TypeError: error loading dynamically imported module: /.test(text) ||
					// WebKit's words for a module load cut by leaving; one that really fails is a failed response too.
					text === 'TypeError: Importing a module script failed.'
				? 'dropped-load-warning'
			// Firefox asks for the tab icon by itself, outside the page: the app declares no such file.
			: text.includes('FaviconLoader.sys.mjs')
				? 'browser-favicon'
			: text.includes('Avoid calling `fetch` eagerly during server side rendering')
				? 'known-svelte-dev-fetch-warning'
				: fixtureRealtimeDiagnostic(text, process.env.CITA_E2E_ENVIRONMENT, process.env.PUBLIC_ODONTO_SUPABASE_URL)
					?? 'unclassified';
		messages.push({
			type,
			category,
			source: safePath(message.location().url),
			line: message.location().lineNumber,
			// A message nobody classified has to say what it is, with its tokens and addresses taken out.
			...(category === 'unclassified' ? { sample: safeBrowserText(text).slice(0, 160) } : {})
		});
	});
	page.on('response', (response) => {
		if (response.status() < 400 || fixtureRealtimeHandshake(response.url())) return;
		if (failedResponses.length >= 100) {
			overflow = true;
			return;
		}
		failedResponses.push({
			status: response.status(),
			method: response.request().method(),
			path: safePath(response.url())
		});
	});
	page.on('requestfailed', (request) => {
		const error = request.failure()?.errorText ?? '';
		if (DROPPED_LOADS.has(error)) return;
		if (networkFailures.length >= 100) {
			overflow = true;
			return;
		}
		networkFailures.push({
			path: safePath(request.url()),
			code: /^(net::|NS_)[A-Z_]+$/.test(error) ? error : 'network-failure'
		});
	});
	return {
		/** Page captures are covered by themselves; a capture of a locator has to go through here. */
		duringCapture,
		async assertAndAttach(info: TestInfo, label: string) {
			const hasTitle = Boolean((await page.title()).trim());
			const report = {
				scope:
					'Actual browser diagnostics on an owned disposable origin; console text/query strings excluded.',
				path: safePath(page.url()),
				hasTitle,
				messages,
				fixtureSocketCloseStates: socketCloseStates,
				failedResponses,
				networkFailures,
				overflow
			};
			await info.attach(label, { body: JSON.stringify(report), contentType: 'application/json' });
			expect(new URL(page.url()).hostname).toBe('127.0.0.1');
			expect(hasTitle).toBe(true);
			expect(await page.locator('vite-error-overlay').count()).toBe(0);
			expect((await page.getByRole('main').innerText()).trim().length).toBeGreaterThan(0);
			expect(overflow).toBe(false);
			expect(networkFailures).toEqual([]);
			expect(failedResponses.filter((failure) => !allowResponse(failure))).toEqual([]);
			expect(failedResponses.filter(allowResponse)).toHaveLength(expectedFailureCount);
			expect(messages.filter((message) => message.category === 'unclassified')).toEqual([]);
			expect(messages.filter((message) => message.category === 'fixture-realtime-cancelled').length,
				'A cancellation warning needs an observed native close while CONNECTING in this run').toBeLessThanOrEqual(socketCloseStates[0]);
			// Every resource error must have a response already checked above; connection failures have their own channel.
			expect(
				messages.filter((message) => message.category === 'resource-failure').length === 0 ||
					failedResponses.length > 0
			).toBe(true);
			return report;
		}
	};
}

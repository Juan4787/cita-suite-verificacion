import { expect, type Page, type TestInfo } from '@playwright/test';
import { fixtureRealtimeDiagnostic } from './realtime-diagnostics';
declare global {
	interface Window {
		__citaFixtureSocketClose: (readyState: number) => Promise<void>;
	}
}
type Failure = { status: number; method: string; path: string };
/** Diagnostic metadata only: never serialize console text, tokens, query strings or clinical values. */
export async function observeRenderHealth(
	page: Page,
	allowResponse: (failure: Failure) => boolean = () => false,
	expectedFailureCount = 0
) {
	const messages: { type: string; category: string; source: string; line: number }[] = [];
	const failedResponses: Failure[] = [],
		networkFailures: { path: string; code: string }[] = [];
	let overflow = false;
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
		await page.addInitScript((apiOrigin) => {
			const api = new URL(apiOrigin);
			const close = WebSocket.prototype.close;
			WebSocket.prototype.close = function (this: WebSocket, code?: number, reason?: string) {
				const target = new URL(this.url);
				if (target.protocol === 'ws:' && target.host === api.host && target.pathname === '/realtime/v1/websocket')
					void window.__citaFixtureSocketClose(this.readyState).catch(() => {});
				return close.call(this, code, reason);
			};
		}, api.origin);
	}
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
		if (messages.length >= 100) {
			overflow = true;
			return;
		}
		const text = message.text();
		const category = text.startsWith('Failed to load resource:')
			? 'resource-failure'
			: text.includes('Avoid calling `fetch` eagerly during server side rendering')
				? 'known-svelte-dev-fetch-warning'
				: fixtureRealtimeDiagnostic(text, process.env.CITA_E2E_ENVIRONMENT, process.env.PUBLIC_ODONTO_SUPABASE_URL)
					?? 'unclassified';
		messages.push({
			type,
			category,
			source: safePath(message.location().url),
			line: message.location().lineNumber
		});
	});
	page.on('response', (response) => {
		if (response.status() < 400) return;
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
		if (error === 'net::ERR_ABORTED') return;
		if (networkFailures.length >= 100) {
			overflow = true;
			return;
		}
		networkFailures.push({
			path: safePath(request.url()),
			code: /^net::[A-Z_]+$/.test(error) ? error : 'network-failure'
		});
	});
	return {
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
		}
	};
}

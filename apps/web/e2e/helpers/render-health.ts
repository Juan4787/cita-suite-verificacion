import { expect, type Page, type TestInfo } from '@playwright/test';
type Failure = { status: number; method: string; path: string };
/** Diagnostic metadata only: never serialize console text, tokens, query strings or clinical values. */
export function observeRenderHealth(
	page: Page,
	allowResponse: (failure: Failure) => boolean = () => false,
	expectedFailureCount = 0
) {
	const messages: { type: string; category: string; diagnostic: string; source: string; line: number }[] = [];
	const failedResponses: Failure[] = [],
		networkFailures: { path: string; code: string }[] = [];
	let overflow = false;
	const safePath = (raw: string) => {
		try {
			return new URL(raw).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');
		} catch {
			return 'unknown';
		}
	};
	// The disposable fixture deliberately runs Auth/Storage/PostgREST, not Realtime.
	// Match only a failed 404 handshake against its exact configured loopback origin.
	// Do not serialize the message: its WebSocket URL contains an API key.
	const isMissingFixtureRealtime = (text: string) => {
		const match = /^WebSocket connection to '(ws:\/\/[^']+)' failed: Error during WebSocket handshake: Unexpected response code: 404$/.exec(text);
		if (!match || process.env.CITA_E2E_ENVIRONMENT !== 'disposable') return false;
		try {
			const socket = new URL(match[1]);
			const api = new URL(process.env.PUBLIC_ODONTO_SUPABASE_URL ?? '');
			return api.hostname === '127.0.0.1' && socket.host === api.host &&
				api.protocol === 'http:' && socket.pathname === '/realtime/v1/websocket';
		} catch {
			return false;
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
				: isMissingFixtureRealtime(text)
					? 'fixture-realtime-unavailable'
					: 'unclassified';
		messages.push({
			type,
			category,
			// Diagnostic labels only. These warnings remain unclassified and fail the
			// assertion below; identifying their source never grants an exemption.
			diagnostic: text.includes('Multiple GoTrueClient instances detected')
				? 'supabase-multiple-auth-clients'
				: text.includes('@supabase/gotrue-js: Lock ')
					? 'supabase-auth-lock-timeout'
					: text.includes('@supabase/gotrue-js: Navigator LockManager')
						? 'supabase-auth-lock-manager'
						: text.includes('Using the user object as returned from supabase.auth.getSession()')
							? 'supabase-unverified-session-user'
							: text.includes('Failed to set initial Realtime auth token:')
								? 'supabase-initial-realtime-auth'
								: text.includes('Realtime send() is automatically falling back to REST API.')
									? 'supabase-realtime-rest-fallback'
									: text.includes('WebSocket is already in CLOSING or CLOSED state')
										? 'websocket-send-after-close'
										: text.includes('WebSocket is closed before the connection is established')
											? 'websocket-close-before-open'
											: text.startsWith('WebSocket connection to ')
												? 'websocket-connection-failure'
												: text.includes('AuthRetryableFetchError')
													? 'supabase-auth-retryable-fetch-error'
													: text.includes('NavigatorLockAcquireTimeoutError')
														? 'supabase-auth-lock-acquire-timeout'
														: text.includes('@supabase/gotrue-js: Session as retrieved from URL')
															? 'supabase-session-from-url'
															: text.includes('WebCrypto API is not supported.')
																? 'supabase-webcrypto-unavailable'
																: 'other',
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
					'Actual browser diagnostics on owned disposable app; console text/query strings excluded.',
				path: safePath(page.url()),
				hasTitle,
				messages,
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
			// Every resource error must have a response already checked above; connection failures have their own channel.
			expect(
				messages.filter((message) => message.category === 'resource-failure').length === 0 ||
					failedResponses.length > 0
			).toBe(true);
		}
	};
}

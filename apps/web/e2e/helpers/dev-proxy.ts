import type { APIResponse } from '@playwright/test';

// wrangler's proxy answers this by itself, without reaching the worker, when a POST finds a connection already closed.
// Its comparison only matches the root path, so the text says «restarted» even if nothing restarted. Production has no such proxy.
const DEV_PROXY_ANSWER = 'Your worker restarted mid-request.';
// Playwright keeps its connections to the dev server open between requests. After a long pause the server has already
// closed one, and a request written on it fails at once with this.
const CLOSED_CONNECTION = /socket hang up|ECONNRESET/;

/**
 * Sends again only after those two failures. Use it only where repeating is safe: the proxy answer never reached the
 * application, and a request repeated after a closed connection must be idempotent by contract.
 */
export async function pastDevProxy(send: () => Promise<APIResponse>) {
	let response: APIResponse;
	try {
		response = await send();
	} catch (error) {
		if (!CLOSED_CONNECTION.test(String(error))) throw error;
		return send();
	}
	if (response.status() !== 503 || !(await response.text()).startsWith(DEV_PROXY_ANSWER)) return response;
	return send();
}

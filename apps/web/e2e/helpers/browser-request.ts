import type { Page } from '@playwright/test';

/** Exercise the browser's own authenticated transport in the owned disposable app. */
export async function browserRequest(
	page: Page,
	path: string,
	options: { method?: 'GET' | 'POST'; data?: unknown } = {}
): Promise<Response> {
	const origin = new URL(page.url());
	const target = new URL(path, origin);
	if (
		process.env.CITA_E2E_ENVIRONMENT !== 'disposable' ||
		origin.hostname !== '127.0.0.1' ||
		!['http:', 'https:'].includes(origin.protocol) ||
		target.origin !== origin.origin || target.username || target.password ||
		!target.pathname.startsWith('/odonto/')
	) throw new Error('Browser fixture requests require the same owned loopback app.');
	const result = await page.evaluate(async ({ url, method, body }) => {
		const response = await fetch(url, {
			method, body, credentials: 'same-origin', redirect: 'manual',
			headers: body === undefined ? undefined : { 'content-type': 'application/json' }
		});
		if (response.type === 'opaqueredirect' || response.status === 0)
			throw new Error('Browser fixture request redirected instead of reaching its contract.');
		return { status: response.status, headers: [...response.headers.entries()], body: await response.text() };
	}, { url: target.href, method: options.method ?? 'GET', body: options.data === undefined ? undefined : JSON.stringify(options.data) });
	return new Response([204, 205, 304].includes(result.status) ? null : result.body, {
		status: result.status, headers: result.headers
	});
}

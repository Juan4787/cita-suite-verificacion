import { createServer } from 'node:http';
import { expect, test, type BrowserContext } from '@playwright/test';
import { browserRequest } from './helpers/browser-request';

test('browser fixture transport preserves Secure loopback cookies without inventing authentication or following redirects', async ({ page, browser }, testInfo) => {
	const server = createServer((request, response) => {
		if (request.url === '/set') {
			response.setHeader('set-cookie', 'owned_transport_probe=fixture-only; Secure; HttpOnly; SameSite=Lax; Path=/');
		}
		if (request.url === '/odonto/redirect') {
			response.writeHead(302, { location: '/login' }).end();
			return;
		}
		if (request.url === '/odonto/probe') {
			const authenticated = request.headers.cookie?.includes('owned_transport_probe=fixture-only') === true;
			response.writeHead(authenticated ? 200 : 401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
			response.end(JSON.stringify({ authenticated }));
			return;
		}
		response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Owned transport probe</title><main>Owned transport probe</main>');
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	let anonymous: BrowserContext | undefined;
	try {
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Owned transport probe did not bind.');
		const origin = `http://127.0.0.1:${address.port}`;
		await page.goto(origin + '/set');
		// Read the jar without the API's URL filter: that filter is the behavior
		// being characterized and omits Secure cookies on HTTP/127.0.0.1.
		const cookies = await page.context().cookies();
		expect(cookies.filter(cookie => cookie.name === 'owned_transport_probe').map(({ secure, httpOnly }) => ({ secure, httpOnly })))
			.toEqual([{ secure: true, httpOnly: true }]);
		// Playwright 1.60.0's API cookie filter accepts localhost, not 127.0.0.1;
		// Chromium sends this Secure cookie on its trustworthy loopback origin.
		const api = await page.request.get(origin + '/odonto/probe', { maxRedirects: 0 });
		expect(api.status()).toBe(401);
		const native = await browserRequest(page, '/odonto/probe');
		expect(native.status).toBe(200);
		expect(native.headers.get('cache-control')).toBe('no-store');
		expect(await native.json()).toEqual({ authenticated: true });
		await expect(browserRequest(page, '/odonto/redirect')).rejects.toThrow('redirected');
		await expect(browserRequest(page, 'https://example.com/odonto/probe')).rejects.toThrow('same owned loopback');
		await expect(browserRequest(page, '/login')).rejects.toThrow('same owned loopback');
		anonymous = await browser.newContext();
		const unsigned = await anonymous.newPage();
		await unsigned.goto(origin + '/empty');
		const denied = await browserRequest(unsigned, '/odonto/probe');
		expect(denied.status).toBe(401);
		expect(await denied.json()).toEqual({ authenticated: false });
		await testInfo.attach('owned-transport', { contentType: 'application/json', body: JSON.stringify({
			apiStatus: api.status(), browserStatus: native.status, anonymousStatus: denied.status,
			secureCookiePreserved: true, redirectsRejected: true, foreignOriginsRejected: true
		}) });
	} finally {
		await anonymous?.close();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	}
});

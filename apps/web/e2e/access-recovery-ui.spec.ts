import { expect, test } from '@playwright/test';
import { authUnavailableResponse } from '../src/lib/server/access/public/auth-unavailable';
import { signInWithPassword } from './helpers/shared-auth';

test('access recovery HTML preserves cookies, works by keyboard and fits all required widths (simulated outage UI)', async ({
	page,
	context
}) => {
	const email = process.env.E2E_EMAIL,
		password = process.env.E2E_PASSWORD;
	if (!email || !password) throw new Error('Explicit synthetic login required for recovery UI.');
	await signInWithPassword(page, email, password);
	const original = (await context.cookies()).filter((cookie) => cookie.name.startsWith('sb-'));
	expect(original.length).toBeGreaterThanOrEqual(3);
	const response = authUnavailableResponse(true);
	const body = await response.text();
	const matches = (url: URL) =>
		url.pathname === '/odonto/agenda' && url.searchParams.has('auth-status-audit');
	// Only this document is intercepted. Hook unit tests exercise actual failure
	// translation; this browser case proves the exact response's layout/CSP/focus.
	await page.route(matches, (route) =>
		route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body })
	);
	try {
		const navigationResponse = await page.goto('/odonto/agenda?auth-status-audit=1');
		expect(navigationResponse?.status()).toBe(503);
		await expect(
			page.getByRole('heading', { name: 'No pudimos comprobar tu sesión' })
		).toBeVisible();
		const retry = page.getByRole('link', { name: 'Volver a intentar' });
		for (const width of [320, 390, 768, 1280, 1600]) {
			await page.setViewportSize({ width, height: 900 });
			await expect
				.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
				.toBe(true);
			expect(await retry.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
				'rgb(124, 58, 237)'
			);
			await page.screenshot({
				type: 'jpeg', quality: 65, path: test.info().outputPath(`access-recovery-${width}.jpg`),
				fullPage: true
			});
		}
		await page.keyboard.press('Tab');
		await expect(retry).toBeFocused();
		for (const before of original)
			expect(
				(await context.cookies()).some(
					(after) => after.name === before.name && after.value === before.value
				)
			).toBe(true);
	} finally {
		await page.unroute(matches);
	}
	const resumed = page.waitForResponse(
		(value) =>
			value.request().isNavigationRequest() && new URL(value.url()).pathname === '/odonto/agenda'
	);
	await page.getByRole('link', { name: 'Volver a intentar' }).press('Enter');
	expect((await resumed).status()).toBe(200);
	await expect(page.getByRole('button', { name: '+ Nuevo turno', exact: true })).toBeVisible();
});

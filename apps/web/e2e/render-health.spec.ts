import { expect, test } from '@playwright/test';
import { observeRenderHealth } from './helpers/render-health';
import { fixtureRealtimeDiagnostic } from './helpers/realtime-diagnostics';

test.describe('render health socket evidence', () => {
	test.beforeEach(() => {
		if (process.env.CITA_E2E_ENVIRONMENT !== 'disposable') throw new Error('Requires the owned disposable fixture.');
	});

	test('a native close while connecting emits the fixture warning without application code', async ({ page }, info) => {
		const api = new URL(process.env.PUBLIC_ODONTO_SUPABASE_URL ?? '');
		const health = await observeRenderHealth(page);
		await page.goto('/login');
		await expect(page.getByRole('main')).toBeVisible();
		const warning = page.waitForEvent('console', {
			predicate: (message) => fixtureRealtimeDiagnostic(message.text(), 'disposable', api.origin) === 'fixture-realtime-cancelled'
		});
		const beforeClose = await page.evaluate(async (socketUrl) => {
			const socket = new WebSocket(socketUrl);
			const closed = new Promise<void>((resolve) => socket.addEventListener('close', () => resolve(), { once: true }));
			const before = socket.readyState;
			socket.close();
			await closed;
			return before;
		}, api.origin.replace('http:', 'ws:') + '/realtime/v1/websocket');
		expect(beforeClose).toBe(0);
		await warning;
		await health.assertAndAttach(info, 'native-socket-close-render-health');
	});

	test('a cancellation message with no observed native close cannot certify console health', async ({ page }, info) => {
		const api = new URL(process.env.PUBLIC_ODONTO_SUPABASE_URL ?? '');
		const health = await observeRenderHealth(page);
		await page.goto('/login');
		await expect(page.getByRole('main')).toBeVisible();
		await page.evaluate((socketUrl) => {
			console.warn(`WebSocket connection to '${socketUrl}' failed: WebSocket is closed before the connection is established.`);
		}, api.origin.replace('http:', 'ws:') + '/realtime/v1/websocket');
		await expect(health.assertAndAttach(info, 'unobserved-socket-close-render-health')).rejects.toThrow(/observed native close/);
	});
});

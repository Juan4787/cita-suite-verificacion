import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authUnavailableResponse } from './auth-unavailable';

const styleOf = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

describe('access service unavailable page', () => {
	it('is light by default and follows the class of the color mode of the device', async () => {
		const light = await authUnavailableResponse(true).text();
		expect(light).toContain('<html lang="es"><head>');
		const dark = await authUnavailableResponse(true, 'dark').text();
		expect(dark).toContain('<html lang="es" class="dark"><head>');
		const system = await authUnavailableResponse(true, 'theme-system').text();
		expect(system).toContain('<html lang="es" class="theme-system"><head>');
		const style = styleOf(light);
		expect(style).toMatch(/:root\{color-scheme:light;--bg:#f5f6f8;/);
		expect(style).toMatch(/:root\.dark\{color-scheme:dark;--bg:#0b1626;/);
		expect(style).toMatch(/@media\(prefers-color-scheme:dark\)\{:root\.theme-system\{color-scheme:dark;--bg:#0b1626;/);
	});

	it('keeps its style allowed by its own policy in every mode', async () => {
		for (const themeClass of ['', 'dark', 'theme-system']) {
			const response = authUnavailableResponse(true, themeClass);
			const hash = createHash('sha256').update(styleOf(await response.text())).digest('base64');
			expect(response.headers.get('content-security-policy')).toContain(`style-src 'sha256-${hash}'`);
			expect(response.status).toBe(503);
		}
	});

	it('answers data requests with plain text', async () => {
		const response = authUnavailableResponse(false, 'dark');
		expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(await response.text()).not.toContain('<html');
	});
});

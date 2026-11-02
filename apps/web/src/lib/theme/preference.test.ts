import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssVariables, themeColor } from './palette.js';
import {
	THEME_COOKIE,
	THEME_PREFERENCES,
	applyThemeToDocument,
	parseThemePreference,
	themeClass,
	themeColorTags
} from './preference';

const template = readFileSync(new URL('../../app.html', import.meta.url), 'utf8');

describe('color mode preference (light mode plan, 6.2)', () => {
	it('is light without a choice and for any unknown value', () => {
		for (const value of [undefined, null, '', 'light', 'LIGHT', 'Dark', ' dark', 'dark ', 'auto', 'system;', '<b>', '1'])
			expect(parseThemePreference(value), String(value)).toBe('light');
		expect(parseThemePreference('dark')).toBe('dark');
		expect(parseThemePreference('system')).toBe('system');
		expect(THEME_COOKIE).toBe('cita-theme');
		expect(THEME_PREFERENCES).toEqual(['light', 'dark', 'system']);
	});

	it('maps each mode to the class whose variables the palette defines', () => {
		expect(themeClass('light')).toBe('');
		expect(themeClass('dark')).toBe('dark');
		expect(themeClass('system')).toBe('theme-system');
	});

	it('paints the browser bar with the page background of the mode', () => {
		expect(themeColor).toEqual({ light: cssVariables('light')['--bg'], dark: cssVariables('dark')['--bg'] });
		expect(themeColorTags('light')).toEqual([{ content: themeColor.light }]);
		expect(themeColorTags('dark')).toEqual([{ content: themeColor.dark }]);
		expect(themeColorTags('system')).toEqual([
			{ content: themeColor.light, media: '(prefers-color-scheme: light)' },
			{ content: themeColor.dark, media: '(prefers-color-scheme: dark)' }
		]);
	});

	it('app.html carries each placeholder exactly once, on <html> and in <head>', () => {
		expect(template.match(/%cita\.theme\.class%/g)).toHaveLength(1);
		expect(template.match(/%cita\.theme\.meta%/g)).toHaveLength(1);
		expect(template).toContain('<html lang="es" class="%cita.theme.class%">');
		expect(template.indexOf('%cita.theme.meta%')).toBeLessThan(template.indexOf('</head>'));
		// The old forced dark script is gone: the server alone decides the first paint.
		expect(template).not.toMatch(/classList\.add\(['"]dark['"]\)/);
	});

	it('renders the server document in the chosen mode, without leftovers', () => {
		const light = applyThemeToDocument(template, 'light');
		expect(light).toContain('<html lang="es" class="">');
		expect(light).toContain(`<meta name="theme-color" content="${themeColor.light}">`);
		const dark = applyThemeToDocument(template, 'dark');
		expect(dark).toContain('<html lang="es" class="dark">');
		expect(dark).toContain(`<meta name="theme-color" content="${themeColor.dark}">`);
		const system = applyThemeToDocument(template, 'system');
		expect(system).toContain('<html lang="es" class="theme-system">');
		expect(system).toContain(`<meta name="theme-color" content="${themeColor.light}" media="(prefers-color-scheme: light)">`);
		expect(system).toContain(`<meta name="theme-color" content="${themeColor.dark}" media="(prefers-color-scheme: dark)">`);
		for (const html of [light, dark, system]) expect(html).not.toContain('%cita.theme');
	});

	it('touches only the head of the template document, never page content', () => {
		const body = '<main><p>Nota: %cita.theme.meta% y class="%cita.theme.class%" escritos por alguien</p></main>';
		const page = template.replace('%sveltekit.body%', body);
		const rendered = applyThemeToDocument(page, 'dark');
		expect(rendered).toContain(body);
		expect(rendered).toContain('<html lang="es" class="dark">');
		// A later chunk of a streamed response has no template head: it is returned as it came.
		expect(applyThemeToDocument(body, 'dark')).toBe(body);
		expect(applyThemeToDocument('<p>sin marcadores</p></head>', 'dark')).toBe('<p>sin marcadores</p></head>');
	});
});

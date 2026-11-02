/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ThemeSelector from './ThemeSelector.svelte';
import { themeColor } from '$lib/theme/palette.js';
import { applyThemePreference } from '$lib/theme/preference';

const themeMeta = () =>
	[...document.head.querySelectorAll('meta[name="theme-color"]')].map((meta) => [meta.getAttribute('content'), meta.getAttribute('media')]);
const cookie = () => document.cookie.split('; ').find((entry) => entry.startsWith('cita-theme='));

beforeEach(() => {
	document.documentElement.className = '';
	document.head.innerHTML = '<meta name="theme-color" content="#000000">';
	document.cookie = 'cita-theme=; Max-Age=0; Path=/';
});
afterEach(cleanup);

describe('applying a color mode in the browser', () => {
	it('switches the class of <html>, the browser bar color and the cookie at once', () => {
		applyThemePreference('dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(themeMeta()).toEqual([[themeColor.dark, null]]);
		expect(cookie()).toBe('cita-theme=dark');

		applyThemePreference('system');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(document.documentElement.classList.contains('theme-system')).toBe(true);
		expect(themeMeta()).toEqual([
			[themeColor.light, '(prefers-color-scheme: light)'],
			[themeColor.dark, '(prefers-color-scheme: dark)']
		]);
		expect(cookie()).toBe('cita-theme=system');

		applyThemePreference('light');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(document.documentElement.classList.contains('theme-system')).toBe(false);
		expect(themeMeta()).toEqual([[themeColor.light, null]]);
		expect(cookie()).toBe('cita-theme=light');
	});

	it('keeps the other classes of <html>', async () => {
		document.documentElement.classList.add('otra-clase');
		applyThemePreference('dark');
		applyThemePreference('light');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect([...document.documentElement.classList]).toEqual(['otra-clase']);
	});

	it('switches every element at once, with transitions off only during the change', async () => {
		applyThemePreference('dark');
		expect(document.documentElement.classList.contains('theme-switching')).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.documentElement.classList.contains('theme-switching')).toBe(false);
		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});
});

describe('the color mode selector', () => {
	it('offers the three modes as native radio buttons on phones, with the current one checked', async () => {
		render(ThemeSelector, { value: 'light' });
		const group = screen.getByRole('group', { name: 'Modo de color' });
		const radios = within(group).getAllByRole('radio');
		expect(radios.map((radio) => radio.closest('label')?.textContent?.trim())).toEqual(['Claro', 'Oscuro', 'Automático']);
		expect(within(group).getByRole('radio', { name: 'Claro' })).toBeChecked();

		await fireEvent.click(within(group).getByRole('radio', { name: 'Oscuro' }));
		expect(within(group).getByRole('radio', { name: 'Oscuro' })).toBeChecked();
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(cookie()).toBe('cita-theme=dark');
	});

	it('is a group of menuitemradio inside the account menu', async () => {
		render(ThemeSelector, { value: 'system', variant: 'menu' });
		const group = screen.getByRole('group', { name: 'Modo de color' });
		const items = within(group).getAllByRole('menuitemradio');
		expect(items.map((item) => [item.textContent?.trim(), item.getAttribute('aria-checked')])).toEqual([
			['Claro', 'false'],
			['Oscuro', 'false'],
			['Automático', 'true']
		]);
		await fireEvent.click(within(group).getByRole('menuitemradio', { name: 'Claro' }));
		expect(within(group).getByRole('menuitemradio', { name: 'Claro' })).toHaveAttribute('aria-checked', 'true');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(document.documentElement.classList.contains('theme-system')).toBe(false);
		expect(cookie()).toBe('cita-theme=light');
	});

	it('gives each selector its own radio group, so two of them never fight', () => {
		render(ThemeSelector, { value: 'light' });
		render(ThemeSelector, { value: 'dark' });
		const names = new Set(screen.getAllByRole('radio').map((radio) => radio.getAttribute('name')));
		expect(names.size).toBe(2);
	});
});

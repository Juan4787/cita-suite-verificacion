import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ThemeSelector from './ThemeSelector.svelte';
import { THEME_LABELS, THEME_PREFERENCES } from '$lib/theme/preference';

// On the server there is no page to read yet: the selector checks the mode of the request, the same one
// the server paints on <html> (src/lib/theme/shown.svelte.ts). In the browser it reads the page itself.
const checkedRadios = (html: string) =>
	[...html.matchAll(/<input\b[^>]*>/g)]
		.filter(([tag]) => /\schecked(?:=|\s|\/|>)/.test(tag))
		.map(([tag]) => tag.match(/\svalue="([^"]*)"/)?.[1]);
const checkedItems = (html: string) =>
	[...html.matchAll(/<button\b[^>]*\saria-checked="true"[^>]*><span>([^<]*)<\/span>/g)].map((match) => match[1]);

describe('the color mode selector rendered on the server', () => {
	it('checks the mode of the request, in both variants', () => {
		for (const value of THEME_PREFERENCES) {
			expect(checkedRadios(render(ThemeSelector, { props: { value } }).body), value).toEqual([value]);
			expect(checkedItems(render(ThemeSelector, { props: { value, variant: 'menu' } }).body), value).toEqual([THEME_LABELS[value]]);
		}
	});
});

import { themeColor } from './palette.js';

/**
 * Color mode chosen on this device (docs/plans/modo-claro-20261102.md, 4 and 6.2).
 * Without a choice, Cita Suite is light even when the device prefers dark.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_COOKIE = 'cita-theme';
/** One year: the choice belongs to the device and survives signing out. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];
export const THEME_LABELS: Record<ThemePreference, string> = {
	light: 'Claro',
	dark: 'Oscuro',
	system: 'Automático'
};

/** Any missing or unknown value is the default, light. */
export function parseThemePreference(value: string | null | undefined): ThemePreference {
	return value === 'dark' || value === 'system' ? value : 'light';
}

/** Class of <html>: the variables of each mode are defined for it (src/lib/theme/palette.js). */
export function themeClass(preference: ThemePreference): string {
	if (preference === 'dark') return 'dark';
	if (preference === 'system') return 'theme-system';
	return '';
}

type ThemeColorTag = { content: string; media?: string };

/** Browser bar color on phones: the page background of the mode in use. */
export function themeColorTags(preference: ThemePreference): ThemeColorTag[] {
	if (preference === 'system')
		return [
			{ content: themeColor.light, media: '(prefers-color-scheme: light)' },
			{ content: themeColor.dark, media: '(prefers-color-scheme: dark)' }
		];
	return [{ content: themeColor[preference] }];
}

function themeColorMarkup(preference: ThemePreference): string {
	return themeColorTags(preference)
		.map((tag) => `<meta name="theme-color" content="${tag.content}"${tag.media ? ` media="${tag.media}"` : ''}>`)
		.join('');
}

const HTML_TAG = 'class="%cita.theme.class%"';

/**
 * Fills the placeholders of app.html on the server, so the first paint already uses the chosen
 * mode: no flash, and no script needed. Only the head of the document from the template is
 * touched: a later chunk, or text a person wrote that happens to contain a placeholder, is not.
 */
export function applyThemeToDocument(html: string, preference: ThemePreference): string {
	const head = html.indexOf('</head>');
	if (head === -1 || !html.slice(0, head).includes(HTML_TAG)) return html;
	const filled = html
		.slice(0, head)
		.replace(HTML_TAG, `class="${themeClass(preference)}"`)
		.replace('%cita.theme.meta%', themeColorMarkup(preference));
	return filled + html.slice(head);
}

/** Applies a new choice at once in the browser and remembers it on this device. */
export function applyThemePreference(preference: ThemePreference, documentRef: Document = document): void {
	const root = documentRef.documentElement;
	// Every element switches at once (app.css): no element fades while the rest already changed.
	root.classList.add('theme-switching');
	root.classList.remove('dark', 'theme-system');
	const className = themeClass(preference);
	if (className) root.classList.add(className);
	// Computing the styles now applies the new mode while transitions are off.
	documentRef.defaultView?.getComputedStyle(root).color;
	setTimeout(() => root.classList.remove('theme-switching'), 0);
	for (const meta of documentRef.head.querySelectorAll('meta[name="theme-color"]')) meta.remove();
	for (const tag of themeColorTags(preference)) {
		const meta = documentRef.createElement('meta');
		// Attributes, not properties: HTMLMetaElement.media is missing in some engines, and without
		// it the second tag would always win in the automatic mode.
		meta.setAttribute('name', 'theme-color');
		meta.setAttribute('content', tag.content);
		if (tag.media) meta.setAttribute('media', tag.media);
		documentRef.head.append(meta);
	}
	const secure = documentRef.location?.protocol === 'https:' ? '; Secure' : '';
	documentRef.cookie = `${THEME_COOKIE}=${preference}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

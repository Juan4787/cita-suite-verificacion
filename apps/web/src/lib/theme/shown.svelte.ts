import { createSubscriber } from 'svelte/reactivity';
import { preferenceShownBy, type ThemePreference } from './preference';

// The class of <html> decides the colors of the page. The server paints it from the cookie on every
// full load, and after that only applyThemePreference changes it. The `themePreference` the root
// layout loads does not follow it: that load does not run again on a navigation, nor when the mode
// changes, so a selector that trusted it showed «Claro» over a dark page (7 November 2026).
const followHtmlClass = createSubscriber((update) => {
	const observer = new MutationObserver(update);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
	return () => observer.disconnect();
});

/**
 * The color mode the page shows, kept up to date in every selector at once. On the server there is
 * no page yet: `requested`, the mode of the request's cookie, is the one the server paints.
 */
export function shownThemePreference(requested: ThemePreference): ThemePreference {
	if (typeof document === 'undefined') return requested;
	followHtmlClass();
	return preferenceShownBy(document.documentElement.classList);
}

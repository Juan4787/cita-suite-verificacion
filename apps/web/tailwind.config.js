import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';
import plugin from 'tailwindcss/plugin';
import { cssVariables, tailwindColors } from './src/lib/theme/palette.js';

// Colors come from src/lib/theme/palette.js: each class color is a CSS variable with a light value
// (default) and a dark one. The server puts `dark` or `theme-system` on <html> from the
// `cita-theme` cookie (hooks.server.ts); `theme-system` follows the device with CSS only.
const colors = tailwindColors();
const themeVariables = plugin(({ addBase }) => {
	// Each block gets its own object: the CSS-in-JS parser consumes the objects it reads.
	const dark = () => ({ colorScheme: 'dark', ...cssVariables('dark') });
	addBase({
		':root': { colorScheme: 'light', ...cssVariables('light') },
		':root.dark': dark(),
		'@media (prefers-color-scheme: dark)': { ':root.theme-system': dark() },
		// Natalia's booking appearance keeps its look from before the light mode: inside its scope, the
		// app variables it does not redefine keep their dark values, whatever mode the visitor chose.
		// :where() has no specificity, so its own variables (BookingAppearance.svelte) always win.
		':where(.booking-natalia, .booking-control-menu-natalia)': cssVariables('dark')
	});
});

/** @type {import('tailwindcss').Config} */
export default {
	darkMode: 'class',
	content: ['./src/**/*.{html,js,svelte,ts}'],
	// The server adds these classes to <html> (hooks.server.ts): their variable blocks must always exist.
	safelist: ['dark', 'theme-system', 'booking-natalia', 'booking-control-menu-natalia'],
	theme: {
		extend: {
			fontFamily: {
				sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif']
			},
			// Named roles of the type scale (DESIGN.md). Size only: each keeps the line
			// height of its context, as the literal values they replace did.
			fontSize: {
				micro: '0.6875rem', // group labels and compact navigation
				caption: '0.8125rem', // field labels of the patient file
				supporting: '0.95rem',
				body: '17px',
				cta: '1.075rem' // the patient's main actions on their appointment page
			},
			textColor: colors.textColor,
			backgroundColor: colors.backgroundColor,
			borderColor: colors.borderColor,
			divideColor: colors.divideColor,
			ringColor: colors.ringColor,
			ringOffsetColor: colors.ringOffsetColor,
			outlineColor: colors.outlineColor,
			accentColor: colors.accentColor,
			boxShadowColor: colors.boxShadowColor,
			gradientColorStops: colors.gradientColorStops,
			boxShadow: {
				card: '0 12px 40px rgba(18,38,63,0.12)'
			}
		}
	},
	plugins: [forms, typography, themeVariables]
}

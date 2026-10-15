import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
	darkMode: 'class',
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			fontFamily: {
				sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif']
			},
			colors: {
				primary: {
					50: '#eef7ff',
					100: '#d8eaff',
					200: '#b5d7ff',
					300: '#82bcff',
					400: '#4f9aff',
					500: '#1f7bff',
					600: '#0b60e6',
					700: '#084bb4',
					800: '#0a3e8e',
					900: '#0d346e'
				},
				neutral: {
					25: '#f8fafc',
					50: '#f5f7fb',
					100: '#e9edf5',
					200: '#d8deec',
					300: '#c2cadd',
					400: '#9aa2ba',
					500: '#6f7794',
					600: '#505772',
					700: '#383e54',
					800: '#242a38',
					900: '#1a1f2b'
				}
			},
			boxShadow: {
				card: '0 12px 40px rgba(18,38,63,0.12)'
			}
		}
	},
	plugins: [forms, typography]
}

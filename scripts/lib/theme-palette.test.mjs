import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cssVariables, tailwindColors, themeColor, tokens } from '../../apps/web/src/lib/theme/palette.js';

// Light mode campaign (docs/plans/modo-claro-20261102.md, 2.6, 7 C9 and 12.1): the palette meets
// WCAG 2.2 on its real values. Text needs 4.5:1 (7:1 for the main text), and field borders, focus
// and icons 3:1. Translucent colors are measured over the surface they are drawn on.

const parse = (value) => {
	let match = value.match(/^#([0-9a-f]{6})$/i);
	if (match) return [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16)).concat(1);
	match = value.match(/^#([0-9a-f]{3})$/i);
	if (match) return [...match[1]].map((c) => parseInt(c + c, 16)).concat(1);
	match = value.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:\s*[/,]\s*([\d.]+))?\s*\)$/);
	return match ? [+match[1], +match[2], +match[3], match[4] === undefined ? 1 : +match[4]] : null;
};
const linear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const over = (color, background) => [0, 1, 2].map((i) => color[i] * color[3] + background[i] * (1 - color[3]));
const ratio = (a, b) => {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};
const modes = { light: cssVariables('light'), dark: cssVariables('dark') };
const color = (mode, name) => {
	const value = parse(modes[mode][name] ?? name);
	assert.ok(value, `${name} has no color in ${mode}`);
	return value;
};
// Contrast of `fg` drawn on `bg`, both resolved in the mode, translucent ones over the page.
const contrast = (mode, fg, bg) => {
	const page = color(mode, '--bg');
	const background = over(color(mode, bg), page);
	return ratio(over(color(mode, fg), background), background);
};

test('the palette is well formed', () => {
	const names = tokens.map(([name]) => name);
	assert.equal(new Set(names).size, names.length, 'Variable names are unique.');
	assert.deepEqual(Object.keys(modes.light).sort(), Object.keys(modes.dark).sort());
	for (const [name, light, dark, note] of tokens) {
		assert.match(name, /^--[a-z0-9-]+$/);
		assert.ok(note?.length > 3, `${name} needs a note`);
		if (name.startsWith('--shadow')) continue;
		assert.ok(parse(light) && parse(dark), `${name}: both values must be colors`);
	}
	assert.equal(themeColor.light, modes.light['--bg']);
	assert.equal(themeColor.dark, modes.dark['--bg']);
});

test('no text color key collides with a font size class', () => {
	const sizes = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl', 'micro', 'caption', 'supporting', 'body', 'cta'];
	const keys = Object.keys(tailwindColors().textColor);
	assert.deepEqual(keys.filter((key) => sizes.includes(key)), []);
});

const PAIRS = [
	// [text or mark, background, minimum, modes]
	['--text', '--bg', 7], ['--text', '--surface', 7], ['--text', '--surface-2', 7], ['--text', '--surface-raised', 7],
	['--text-muted', '--bg', 4.5], ['--text-muted', '--surface', 4.5], ['--text-muted', '--surface-2', 4.5], ['--text-muted', '--surface-raised', 4.5],
	['--text-subtle', '--bg', 4.5], ['--text-subtle', '--surface', 4.5], ['--text-subtle', '--surface-2', 4.5], ['--text-subtle', '--surface-raised', 4.5],
	['--accent-text', '--surface', 4.5], ['--accent-text', '--accent-soft', 4.5],
	['--on-accent', '--accent-strong', 4.5], ['--on-accent', '--accent-press', 4.5], ['--on-accent', '--danger-strong', 4.5], ['--on-accent', '--danger-press', 4.5],
	['--success-text', '--success-soft', 4.5], ['--warning-text', '--warning-soft', 4.5], ['--danger-text', '--danger-soft', 4.5],
	['--danger-text', '--surface', 4.5], ['--info-text', '--info-soft', 4.5],
	['--ring', '--bg', 3], ['--ring', '--surface', 3], ['--ring', '--surface-raised', 3],
	['--field-border', '--bg', 3], ['--field-border', '--surface', 3], ['--field-border', '--surface-raised', 3],
	['--success', '--surface', 3], ['--warning', '--surface', 3], ['--danger', '--surface', 3],
	['--patient-field-border', '--bg', 3], ['--menu-selected-text', '--accent-soft', 4.5], ['--dialog-text', '--surface-raised', 4.5],
	['--calendar-weekday', '--surface-raised', 4.5], ['--tab-text', '--surface', 4.5], ['--on-inverse', '--inverse', 7]
];

for (const mode of ['light', 'dark'])
	test(`core pairs meet WCAG 2.2 in ${mode}`, () => {
		const failures = PAIRS.map(([fg, bg, minimum]) => [fg, bg, minimum, contrast(mode, fg, bg)])
			.filter(([, , minimum, value]) => value < minimum)
			.map(([fg, bg, minimum, value]) => `${fg} on ${bg}: ${value.toFixed(2)} < ${minimum}`);
		assert.deepEqual(failures, []);
	});

test('the approved light palette keeps its main text at AAA and its primary button text at AAA', () => {
	assert.ok(contrast('light', '--text', '--surface') >= 17);
	assert.ok(contrast('light', '--on-accent', '--accent-strong') >= 7);
});

test('every generated text color is readable in light', () => {
	const failures = [];
	for (const [name] of tokens.filter(([name]) => name.startsWith('--c-text-')))
		for (const background of ['#ffffff', modes.light['--bg']]) {
			const value = ratio(over(color('light', name), parse(background)), parse(background));
			if (value < 4.5) failures.push(`${name} on ${background}: ${value.toFixed(2)}`);
		}
	assert.deepEqual(failures, []);
});

// In dark, these stay faint on purpose: WCAG exempts decoration and inactive controls (12.1).
const DARK_DECORATIVE = {
	'--c-text-fg-35': 'íconos decorativos marcados aria-hidden (chevrones, lupas)',
	'--c-text-fg-30': 'chevrones decorativos marcados aria-hidden',
	'--c-text-fg-25': 'separadores «/» aria-hidden y «Equipo de profesionales» con aria-disabled',
	'--c-text-fg-20': 'días pasados del calendario, botones deshabilitados'
};

test('every generated text color is readable in dark, except the documented decorative ones', () => {
	const surface = color('dark', '--surface');
	const weak = tokens
		.filter(([name]) => name.startsWith('--c-text-') && !name.startsWith('--c-text-ink-'))
		.filter(([name]) => ratio(over(color('dark', name), surface), surface) < 4.5)
		.map(([name]) => name)
		.sort();
	assert.deepEqual(weak, Object.keys(DARK_DECORATIVE).sort());
	// Ink tokens are dark text kept on light chips in both modes.
	const inkFailures = tokens.filter(([name]) => name.startsWith('--c-text-ink-'))
		.filter(([name]) => ratio(color('dark', name), [255, 255, 255]) < 4.5).map(([name]) => name);
	assert.deepEqual(inkFailures, []);
});

test('every background that carries white text keeps 4.5:1 in both modes', () => {
	// Backgrounds used with text-on-accent in the app.
	const root = process.cwd();
	const used = new Set();
	(function walk(directory) {
		for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
			const child = `${directory}/${entry.name}`;
			if (entry.isDirectory()) walk(child);
			else if (/\.svelte$/.test(entry.name))
				for (const unit of fs.readFileSync(path.join(root, child), 'utf8').matchAll(/[^"'`{}]+/g))
					if (/(?<![\w-])text-on-accent(?![\w-])/.test(unit[0]))
						for (const match of unit[0].matchAll(/(?<![\w-])bg-([a-z0-9-]+)(?![\w/-])/g)) used.add(match[1]);
		}
	})('apps/web/src');
	const backgrounds = tailwindColors().backgroundColor;
	const failures = [];
	for (const key of used) {
		const variable = backgrounds[key]?.slice(4, -1);
		if (!variable) continue;
		for (const mode of ['light', 'dark']) {
			const value = contrast(mode, '--on-accent', variable);
			if (value < 4.5) failures.push(`bg-${key} (${variable}) ${mode}: ${value.toFixed(2)}`);
		}
	}
	assert.ok(used.size >= 5, 'The check must see the app backgrounds that carry white text.');
	assert.deepEqual(failures, []);
});

test('Natalia booking markers and their rules match one to one', () => {
	const root = process.cwd();
	const appearance = fs.readFileSync(path.join(root, 'apps/web/src/lib/booking/BookingAppearance.svelte'), 'utf8');
	const ruled = new Set([...appearance.matchAll(/\.booking-natalia \.(bk-[a-z-]+)\)/g)].map((match) => match[1]));
	const used = new Set();
	(function walk(directory) {
		for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
			const child = `${directory}/${entry.name}`;
			if (entry.isDirectory()) walk(child);
			else if (/\.svelte$/.test(entry.name) && !child.endsWith('BookingAppearance.svelte'))
				for (const match of fs.readFileSync(path.join(root, child), 'utf8').matchAll(/(?<![\w-])(bk-[a-z-]+)(?![\w-])/g)) used.add(match[1]);
		}
	})('apps/web/src');
	assert.ok(ruled.size >= 10);
	assert.deepEqual([...used].filter((marker) => !ruled.has(marker)), [], 'A marker without a rule does nothing.');
	// In V11f no booking string matched `[class*='text-amber-']`; the rule stays so Natalia's status
	// palette is complete. Any other rule without a marker is dead and must go.
	assert.deepEqual([...ruled].filter((marker) => !used.has(marker)).sort(), ['bk-warning-text']);
});

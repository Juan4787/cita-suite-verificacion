import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { COLOR_CLASS, EXCEPTIONS, applyExceptions, scanText, scanTree } from './theme-colors.mjs';
import { tokens, tailwindColors } from '../../apps/web/src/lib/theme/palette.js';

// Light mode campaign (docs/plans/modo-claro-20261102.md, 6.4): every color of the web app comes from
// the theme variables of src/lib/theme/palette.js. A color written by hand would not follow the
// light or dark mode the person chose.

const classes = (text) => [...text.matchAll(COLOR_CLASS)].map((match) => match[0]);

test('the detector finds every form of hand-written color class', () => {
	const forbidden = [
		'text-white', 'bg-white/10', 'hover:text-neutral-500', 'dark:border-[#1f3554]', 'bg-[#7c3aed]/15',
		'border-t-red-400/40', 'ring-[#8b5cf6]/50', 'shadow-black/40', 'from-[#0b1626]', 'placeholder:text-white/40',
		'!text-white', 'accent-[#7c3aed]', 'focus-visible:outline-primary-500', 'divide-white/10', 'fill-white',
		'bg-[rgba(1,2,3,0.4)]', 'text-[#c4b5fd]', 'bg-white/[0.04]', 'ring-offset-[#0f1f36]', 'via-slate-900'
	];
	for (const value of forbidden) assert.deepEqual(classes(`class="p-2 ${value} m-1"`), [value], value);
});

test('the detector leaves theme classes and non-color utilities alone', () => {
	const allowed = 'text-fg-55 bg-surface text-transparent bg-current text-sm border-line whitespace-nowrap bg-fill-04 text-on-accent ring-offset-surface shadow-shade-accent-600-20 text-copy-subtle border-2 outline-none';
	assert.deepEqual(classes(`class="${allowed}"`), []);
});

test('literals are found in styles, style attributes, code strings and encoded images', () => {
	const component = [
		'<script>const tone = "#fff"; const ok = "var(--text)";</script>',
		'<a href="#main" style="color: rgba(0, 0, 0, 0.5)">x</a>',
		'<style>.a { color: #fff; background: white; border-color: var(--border); }',
		'.b { --local: #123456; background: url("data:image/svg+xml,%3Csvg stroke=\'%23c4b5fd\'%3E"); }</style>'
	].join('\n');
	const kinds = scanText('apps/web/src/lib/Example.svelte', component).map((finding) => `${finding.kind}:${finding.value}`);
	assert.deepEqual(kinds.sort(), ['code:#fff', 'css:#123456', 'css:#fff', 'css:rgba(', 'css:white', 'encoded:%23c4b5fd'].sort());
	// Only the files that define the variables may write a literal, and only as a `--name:` value.
	const sources = scanText('apps/web/src/app.css', ':root { --x: #123456; }\n.a { color: #abcdef; }');
	assert.deepEqual(sources.map((finding) => finding.value), ['#abcdef']);
	assert.deepEqual(scanText('apps/web/src/lib/X.svelte', '<div class="dark:border p-2">').map((f) => f.kind), ['dark-variant']);
});

test('the web app has no hand-written colors outside the reviewed exceptions', () => {
	for (const exception of EXCEPTIONS) assert.ok(exception.reason?.length > 20, `${exception.file} needs its reason`);
	const { remaining, stale } = applyExceptions(scanTree(process.cwd()));
	assert.deepEqual(stale, [], 'An exception that no longer matches anything must be removed.');
	assert.deepEqual(remaining.map((finding) => `${finding.file}:${finding.line} ${finding.kind} ${finding.value}`), []);
});

// Tailwind silently ignores a class it does not know: a misspelled theme class would leave an element
// without color. Every theme color class used must exist in the palette.
const UTILITY_PREFIX = {
	textColor: ['text'], backgroundColor: ['bg'], borderColor: ['border', 'border-x', 'border-y', 'border-t', 'border-r', 'border-b', 'border-l'],
	divideColor: ['divide'], ringColor: ['ring'], ringOffsetColor: ['ring-offset'], outlineColor: ['outline'],
	accentColor: ['accent'], boxShadowColor: ['shadow'], gradientColorStops: ['from', 'via', 'to']
};
const FAMILIES = ['fg', 'copy', 'fill', 'line', 'canvas', 'surface', 'raised', 'accent', 'success', 'warning', 'danger', 'info', 'ink', 'chip', 'focus', 'shade', 'check', 'on-accent', 'inverse', 'on-inverse', 'ring'];
const THEME_CLASS = new RegExp(
	`(?<![\\w-])(?:[a-z0-9-]+:|has-\\[[^\\]]+\\]:)*(text|bg|border(?:-[xytrbl])?|divide|ring-offset|ring|outline|accent|shadow|from|via|to)-((?:${FAMILIES.join('|')})(?:-[a-z0-9]+)*)(?![\\w/-])`,
	'g'
);
const known = (() => {
	const colors = tailwindColors();
	const set = new Set();
	for (const [utility, keys] of Object.entries(colors)) for (const key of Object.keys(keys)) for (const prefix of UTILITY_PREFIX[utility]) set.add(`${prefix}-${key}`);
	return set;
})();
// Utilities whose names look like a color but are not one (border widths and outline styles).
const NOT_COLORS = new Set(['outline-offset-2', 'ring-offset-2', 'ring-offset-1']);

function sourceFiles(root) {
	const files = [];
	(function walk(directory) {
		for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
			const child = `${directory}/${entry.name}`;
			if (entry.isDirectory()) walk(child);
			else if (/\.(svelte|ts|css|html)$/.test(entry.name) && !/\.(test|spec)\.ts$|\.d\.ts$/.test(entry.name)) files.push(child);
		}
	})('apps/web/src');
	return files;
}

const unknownClasses = (text) =>
	[...text.matchAll(THEME_CLASS)].map((match) => `${match[1]}-${match[2]}`).filter((name) => !known.has(name) && !NOT_COLORS.has(name));

test('the class check rejects a theme class that does not exist', () => {
	assert.deepEqual(unknownClasses('class="text-fg-55 hover:bg-fill-10 border-t-line has-[:focus-visible]:outline-ring"'), []);
	assert.deepEqual(unknownClasses('class="bg-fill-inventada-99 text-fg-56 border-danger-123"'), ['bg-fill-inventada-99', 'text-fg-56', 'border-danger-123']);
});

test('every theme color class used by the web app exists in the palette', () => {
	const root = process.cwd();
	const missing = [];
	for (const file of sourceFiles(root)) for (const name of unknownClasses(fs.readFileSync(path.join(root, file), 'utf8'))) missing.push(`${file}: ${name}`);
	assert.deepEqual(missing, []);
});

// A misspelled var(--name) is just as silent: the property falls back to its initial value.
test('every CSS variable the web app reads is defined', () => {
	const root = process.cwd();
	const defined = new Set(tokens.map(([name]) => name));
	const texts = sourceFiles(root).map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]);
	for (const [, text] of texts) for (const match of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(match[1]);
	const undefinedVariables = [];
	for (const [file, text] of texts)
		for (const match of text.matchAll(/var\((--[\w-]+)/g))
			if (!defined.has(match[1]) && !match[1].startsWith('--tw-')) undefinedVariables.push(`${file}: ${match[1]}`);
	assert.deepEqual([...new Set(undefinedVariables)], []);
});

test('every generated palette variable is used by the web app', () => {
	const root = process.cwd();
	const all = sourceFiles(root).map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
	const unused = [];
	for (const [name, , , , utilities] of tokens) {
		if (!name.startsWith('--c-')) continue;
		const used = all.includes(`var(${name})`) || Object.entries(utilities ?? {}).some(([utility, keys]) =>
			keys.some((key) => UTILITY_PREFIX[utility].some((prefix) => new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*${prefix}-${key}(?![\\w/-])`).test(all))));
		if (!used) unused.push(name);
	}
	assert.deepEqual(unused, [], 'A generated variable nobody uses should be removed from the palette.');
});

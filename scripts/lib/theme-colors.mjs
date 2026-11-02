// Finds colors written by hand in the web app: Tailwind palette and arbitrary color classes,
// and color literals in styles, style attributes, encoded images and code strings.
// Colors belong to the theme variables of app.css (light by default, dark under `.dark`);
// a literal elsewhere would not follow the person's light or dark choice.
// Usage, from the repository root: node scripts/lib/theme-colors.mjs [--json <file>] [--list]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROPERTIES = '(?:text|bg|border(?:-[xytrbl])?|ring(?:-offset)?|outline|divide|from|via|to|fill|stroke|shadow|decoration|accent|caret|placeholder)';
const PALETTE = '(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary)(?:-(?:25|50|[1-9]00|950))?';
const ARBITRARY = '\\[(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\\([^\\]\\s]*\\)|color:[^\\]\\s]+)\\]';
const ALPHA = '(?:/(?:\\d{1,3}|\\[[\\d.]+%?\\]))?';

/** A Tailwind class whose color is a raw palette or arbitrary value, with any variants. */
export const COLOR_CLASS = new RegExp(
	`(?<![\\w\\[/-])((?:[a-z0-9-]+:)*)(!?)(${PROPERTIES})-(${PALETTE}|${ARBITRARY})${ALPHA}(?![\\w/\\]-])`,
	'g'
);
/** Any Tailwind `dark:` variant: theme variables replace them, and the automatic mode ignores them. */
export const DARK_VARIANT = /(?<![\w-])(?:[a-z0-9-]+:)*dark:[^\s"'`{}<>]+/g;
const HEX = /(?<![\w#&%-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g;
const ENCODED_HEX = /%23(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F])/g;
const NAMED_VALUE = /(?<=:\s*|\s)(?:white|black)(?=\s*(?:;|!|\}|$))/g;

/** Files that define the theme variables themselves: literals are allowed only as `--name:` values. */
export const VARIABLE_SOURCES = new Set([
	'apps/web/src/app.css',
	'apps/web/src/lib/booking/BookingAppearance.svelte',
	'apps/web/src/lib/server/access/public/auth-unavailable.ts'
]);

/**
 * Reviewed exceptions. Each one names the file, the exact text and why it is not a theme color.
 * A stale exception (its text no longer present) fails the guard, so the list cannot rot.
 */
export const EXCEPTIONS = [
	{
		file: 'apps/web/src/app.css',
		value: '%23ffffff',
		reason: 'Tilde y punto blancos de casillas y botones de opción: se dibujan sobre el acento en los dos modos.'
	},
	{ file: 'apps/web/src/lib/patient-export/xlsx-adapter.ts', value: '#FFFFFF', reason: 'Estilo del Excel exportado: el archivo no cambia con el modo de la app.' },
	{ file: 'apps/web/src/lib/patient-export/xlsx-adapter.ts', value: '#0F766E', reason: 'Estilo del Excel exportado: el archivo no cambia con el modo de la app.' },
	{ file: 'apps/web/src/lib/patient-export/xlsx-adapter.ts', value: '#115E59', reason: 'Estilo del Excel exportado: el archivo no cambia con el modo de la app.' },
	{
		file: 'apps/web/src/lib/components/patients/ClinicalImageViewer.svelte',
		all: true,
		reason: 'Visor de radiografías e imágenes clínicas: siempre oscuro, en los dos modos, para conservar el contraste de las zonas oscuras de la imagen (plan de modo claro, sección 5). No usa variables del modo.'
	}
];

function lineOf(text, index) {
	let line = 1;
	for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
	return line;
}

/** Ranges of `--name: value;` declarations, where a literal defines a variable. */
function variableDeclarationRanges(text) {
	const ranges = [];
	for (const match of text.matchAll(/--[\w-]+\s*:[^;{}]*;?/g)) ranges.push([match.index, match.index + match[0].length]);
	return ranges;
}

function insideAny(ranges, index) {
	return ranges.some(([start, end]) => index >= start && index < end);
}

/** Blocks of CSS inside a Svelte component, plus style attributes and style directives. */
function cssRanges(file, text) {
	if (file.endsWith('.css')) return [[0, text.length]];
	const ranges = [];
	for (const match of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) ranges.push([match.index, match.index + match[0].length]);
	for (const match of text.matchAll(/\sstyle(?::[\w-]+)?=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g)) ranges.push([match.index, match.index + match[0].length]);
	return ranges;
}

/** String and template literals in code (scripts of components and TypeScript modules). */
function codeStringRanges(file, text) {
	if (file.endsWith('.css')) return [];
	const scripts = file.endsWith('.svelte')
		? [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => [match.index, match.index + match[0].length])
		: [[0, text.length]];
	const ranges = [];
	for (const [start, end] of scripts) {
		const code = text.slice(start, end);
		for (const match of code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g))
			ranges.push([start + match.index, start + match.index + match[0].length]);
	}
	return ranges;
}

/**
 * Every hand-written color in one file.
 * kind: 'class' (Tailwind color class), 'dark-variant', 'css' (literal in styles),
 * 'code' (literal in a code string) or 'encoded' (inside an encoded image).
 */
export function scanText(file, text) {
	const found = [];
	const add = (kind, index, value) => found.push({ file, line: lineOf(text, index), kind, value });
	const variables = VARIABLE_SOURCES.has(file) ? variableDeclarationRanges(text) : [];
	for (const match of text.matchAll(COLOR_CLASS)) add('class', match.index, match[0]);
	for (const match of text.matchAll(DARK_VARIANT)) {
		COLOR_CLASS.lastIndex = 0;
		if (!COLOR_CLASS.test(match[0])) add('dark-variant', match.index, match[0]);
		COLOR_CLASS.lastIndex = 0;
	}
	const styles = cssRanges(file, text);
	const strings = codeStringRanges(file, text);
	for (const pattern of [HEX, COLOR_FUNCTION, NAMED_VALUE]) {
		for (const match of text.matchAll(pattern)) {
			if (insideAny(variables, match.index)) continue;
			const inStyle = insideAny(styles, match.index);
			const inString = insideAny(strings, match.index);
			// Arbitrary classes are already reported as classes.
			const insideClass = /\[[^\]\s]*$/.test(text.slice(Math.max(0, match.index - 40), match.index));
			if (insideClass) continue;
			if (pattern === NAMED_VALUE && !inStyle) continue;
			if (inStyle) add('css', match.index, match[0]);
			else if (inString) add('code', match.index, match[0]);
		}
	}
	for (const match of text.matchAll(ENCODED_HEX)) if (!insideAny(variables, match.index)) add('encoded', match.index, match[0]);
	return found.sort((a, b) => a.line - b.line);
}

const SCANNED = /\.(svelte|ts|css|html)$/;
const SKIPPED = /\.(test|spec)\.ts$|\.d\.ts$/;

export function scanTree(root, directory = 'apps/web/src') {
	const results = [];
	const walk = (relative) => {
		for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
			const child = `${relative}/${entry.name}`;
			if (entry.isDirectory()) walk(child);
			else if (SCANNED.test(entry.name) && !SKIPPED.test(entry.name))
				results.push(...scanText(child, fs.readFileSync(path.join(root, child), 'utf8')));
		}
	};
	walk(directory);
	return results;
}

/** Findings left after the reviewed exceptions, plus exceptions that no longer match anything. */
export function applyExceptions(findings, exceptions = EXCEPTIONS) {
	const used = new Set();
	const remaining = findings.filter((finding) => {
		const index = exceptions.findIndex((exception) => exception.file === finding.file && (exception.all || exception.value === finding.value));
		if (index === -1) return true;
		used.add(index);
		return false;
	});
	const stale = exceptions.filter((_, index) => !used.has(index));
	return { remaining, stale };
}

export function summarize(findings) {
	const byKind = {};
	const byFile = {};
	for (const finding of findings) {
		byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
		byFile[finding.file] = (byFile[finding.file] ?? 0) + 1;
	}
	const files = Object.entries(byFile).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	return { total: findings.length, byKind, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const root = fileURLToPath(new URL('../../', import.meta.url));
	const { remaining, stale } = applyExceptions(scanTree(root));
	const summary = summarize(remaining);
	const json = process.argv.indexOf('--json');
	if (json !== -1) {
		const target = process.argv[json + 1];
		if (!target || fs.existsSync(target)) throw new Error('--json needs a new file path (receipts are never overwritten).');
		fs.writeFileSync(target, JSON.stringify({ generatedAt: new Date().toISOString(), summary, stale, findings: remaining }, null, '\t') + '\n', { mode: 0o600 });
	}
	console.log(`Colores escritos a mano: ${summary.total}`);
	for (const [kind, count] of Object.entries(summary.byKind)) console.log(`  ${kind}: ${count}`);
	console.log(`Archivos con colores escritos a mano: ${summary.files.length}`);
	for (const [file, count] of summary.files.slice(0, process.argv.includes('--list') ? undefined : 15)) console.log(`  ${String(count).padStart(4)}  ${file}`);
	if (stale.length) console.log(`Excepciones sin uso (hay que quitarlas): ${stale.length}`);
}

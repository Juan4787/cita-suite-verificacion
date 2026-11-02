import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Color modes of the app (docs/plans/modo-claro-20261102.md, 6.2): light by default; `dark` and
// `system` come from the cita-theme cookie of the device, and the server renders the first paint.
export type ThemeChoice = 'light' | 'dark';

const origin = (page: Page) => {
	const current = page.url();
	return new URL(current.startsWith('http') ? current : (process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173')).origin;
};

/** The choice of this device, as the selector stores it: the next document is rendered in it. */
export async function chooseTheme(page: Page, theme: ThemeChoice | 'system') {
	await page.context().addCookies([{ name: 'cita-theme', value: theme, url: origin(page) }]);
}

/** Applies a mode to the open page as the selector does, for tasks that a reload would lose. */
export async function applyThemeInPage(page: Page, theme: ThemeChoice) {
	await chooseTheme(page, theme);
	await page.evaluate((theme) => {
		document.documentElement.classList.remove('dark', 'theme-system');
		if (theme === 'dark') document.documentElement.classList.add('dark');
	}, theme);
}

export async function expectRenderedTheme(page: Page, theme: ThemeChoice) {
	await expect
		.poll(() =>
			page.evaluate(() => ({
				dark: document.documentElement.classList.contains('dark'),
				scheme: getComputedStyle(document.documentElement).colorScheme
			}))
		)
		.toEqual({ dark: theme === 'dark', scheme: theme });
}

export type ContrastViolation = { target: string; html: string; ratio: number; expected: number; foreground: string; background: string; measure: 'axe' | 'worst-case' };
/** A node neither axe nor the worst-case measure could decide, with the reason (`emptyValue`, `image`, `opacity`…). */
export type UndecidedContrast = { target: string; reason: string; text: string };
type AxeData = { contrastRatio?: number; expectedContrastRatio?: string; fgColor?: string; bgColor?: string; messageKey?: string };
type AxeNode = { target: unknown[]; html: string; any: { data?: AxeData }[] };
type WorstCase = { ratio: number; expected: number; foreground: string; background: string } | { reason: string };

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

/**
 * WCAG 2.2 text contrast of the page. axe-core's color-contrast rule decides most text; the engine is
 * evaluated through the browser protocol, so the page keeps its own Content Security Policy.
 * axe leaves undecided the text over a gradient, under another element or of a single character.
 * Those are measured in their worst case: the text against every combination of the gradient stops
 * of its ancestors, with their colors and opacities composed up to the document (the minimum is
 * 4.5:1, or 3:1 for large text). A form control's background image is its arrow or calendar icon,
 * not the text's background. What neither can measure (an empty field, text over an image) stays
 * in `undecided`, never counted as passed. `scope` limits the measure to an open dialog or menu,
 * whose backdrop covers the page on purpose.
 */
export async function contrastViolations(
	page: Page,
	scope?: string
): Promise<{ violations: ContrastViolation[]; incomplete: number; worstCase: number; undecided: UndecidedContrast[]; passes: number }> {
	// The script's last value is the axe object, which cannot cross the protocol: end with `true`.
	if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(`${axeSource}\n;true`);
	const result = await page.evaluate(async (scope) => {
		const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { nodes: AxeNode[] }[]; incomplete: { nodes: AxeNode[] }[]; passes: { nodes: unknown[] }[] }> } }).axe;
		const run = await axe.run(scope ? { include: [[scope]] } : document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
		type Color = [number, number, number, number];
		const parse = (value: string): Color | null => {
			const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)/);
			if (!m) return null;
			return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[5] === '%' ? +m[4] / 100 : +m[4]];
		};
		const linear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
		const luminance = (c: Color) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
		const over = (top: Color, bottom: Color): Color => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1) as Color;
		const ratio = (a: Color, b: Color) => {
			const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
			return (x + 0.05) / (y + 0.05);
		};
		const hex = (c: Color) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
		const gradients = (image: string) =>
			[...image.matchAll(/(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/g)].map((gradient) =>
				[...gradient[0].matchAll(/rgba?\([^)]*\)/g)].map((stop) => parse(stop[0])).filter((stop): stop is Color => stop !== null)
			);
		const worstCase = (selector: string): WorstCase => {
			let element: Element | null;
			try {
				element = document.querySelector(selector);
			} catch {
				return { reason: 'selector' }; // A target inside a frame or a shadow root.
			}
			if (!element) return { reason: 'missing' };
			const text = parse(getComputedStyle(element).color);
			if (!text) return { reason: 'color' };
			// Every ancestor up to the document, outermost first: its color, its gradients, an image
			// (unknown color) and its opacity, which blends its whole content with what lies behind.
			const layers: { solid: Color | null; gradients: Color[][]; image: boolean; opacity: number }[] = [];
			for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
				const style = getComputedStyle(ancestor);
				const solid = parse(style.backgroundColor);
				layers.unshift({
					solid: solid && solid[3] > 0 ? solid : null,
					gradients: style.backgroundImage === 'none' ? [] : gradients(style.backgroundImage),
					image: style.backgroundImage.includes('url(') && !(ancestor === element && /^(SELECT|INPUT)$/.test(ancestor.tagName)),
					opacity: Number(style.opacity)
				});
			}
			const paint = (top: Color, bottom: Color | null): Color | null => (top[3] >= 1 ? top : bottom && over(top, bottom));
			const mix = (color: Color | null, backdrop: Color | null, alpha: number): Color | null =>
				color && backdrop ? over([color[0], color[1], color[2], alpha], backdrop) : null;
			type Pair = { background: Color | null; foreground: Color | null };
			const render = (index: number, backdrop: Color | null): Pair[] => {
				if (index === layers.length) return [{ background: backdrop, foreground: paint(text, backdrop) }];
				const layer = layers[index];
				let bases: (Color | null)[] = [layer.solid ? paint(layer.solid, backdrop) : backdrop];
				if (layer.image) bases = [null];
				// The first background image listed is painted on top: compose from the last one.
				for (const stops of [...layer.gradients].reverse()) bases = bases.flatMap((base) => stops.map((stop) => paint(stop, base)));
				const pairs = bases.flatMap((base) => render(index + 1, base));
				return layer.opacity < 1
					? pairs.map(({ background, foreground }) => ({ background: mix(background, backdrop, layer.opacity), foreground: mix(foreground, backdrop, layer.opacity) }))
					: pairs;
			};
			const pairs = render(0, [255, 255, 255, 1]);
			if (pairs.some((pair) => !pair.background || !pair.foreground)) return { reason: 'image' };
			const style = getComputedStyle(element);
			const size = parseFloat(style.fontSize);
			const expected = size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
			let worst = { ratio: Infinity, foreground: '', background: '' };
			for (const pair of pairs as { background: Color; foreground: Color }[]) {
				const value = ratio(pair.foreground, pair.background);
				if (value < worst.ratio) worst = { ratio: value, foreground: hex(pair.foreground), background: hex(pair.background) };
			}
			return { ...worst, ratio: Math.round(worst.ratio * 100) / 100, expected };
		};
		const textOf = (selector: string) => {
			try {
				return (document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
			} catch {
				return '';
			}
		};
		const nodes = (list: { nodes: AxeNode[] }[]) =>
			list.flatMap((rule) => rule.nodes.map((node) => ({ target: node.target.map(String).join(' '), html: node.html.slice(0, 200), data: node.any[0]?.data ?? {} })));
		const measured = nodes(run.incomplete).map((node) => ({ node, worst: node.data.messageKey === 'emptyValue' ? { reason: 'emptyValue' } : worstCase(node.target) }));
		return {
			violations: nodes(run.violations),
			measured: measured.flatMap(({ node, worst }) => ('ratio' in worst ? [{ target: node.target, html: node.html, ...worst }] : [])),
			undecided: measured.flatMap(({ node, worst }) => ('reason' in worst ? [{ target: node.target, reason: worst.reason, text: textOf(node.target) }] : [])),
			passes: run.passes.reduce((total, rule) => total + rule.nodes.length, 0)
		};
	}, scope);
	const failing = result.measured.filter((node) => node.ratio < node.expected);
	return {
		violations: [
			...result.violations.map((node) => ({
				target: node.target,
				html: node.html,
				ratio: Number(node.data.contrastRatio ?? 0),
				expected: Number(String(node.data.expectedContrastRatio ?? '4.5').replace(':1', '')),
				foreground: String(node.data.fgColor ?? ''),
				background: String(node.data.bgColor ?? ''),
				measure: 'axe' as const
			})),
			...failing.map((node) => ({ ...node, measure: 'worst-case' as const }))
		],
		incomplete: result.measured.length + result.undecided.length,
		worstCase: result.measured.length,
		undecided: result.undecided,
		passes: result.passes + result.measured.length - failing.length
	};
}

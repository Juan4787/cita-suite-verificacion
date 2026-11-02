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

export type ContrastViolation = { target: string; html: string; ratio: number; expected: number; foreground: string; background: string };
type AxeNode = { target: unknown[]; html: string; any: { data?: { contrastRatio?: number; expectedContrastRatio?: string; fgColor?: string; bgColor?: string } }[] };

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

/**
 * WCAG 2.2 text contrast of the page with axe-core's color-contrast rule. The engine is evaluated
 * through the browser protocol, so the page keeps its own Content Security Policy.
 * `incomplete` are nodes axe cannot decide (text over a gradient or an image): they are reported
 * for review, never counted as passed.
 */
export async function contrastViolations(page: Page): Promise<{ violations: ContrastViolation[]; incomplete: number; passes: number }> {
	// The script's last value is the axe object, which cannot cross the protocol: end with `true`.
	if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(`${axeSource}\n;true`);
	const result = await page.evaluate(async () => {
		const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { nodes: AxeNode[] }[]; incomplete: { nodes: unknown[] }[]; passes: { nodes: unknown[] }[] }> } }).axe;
		const run = await axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
		return {
			violations: run.violations.flatMap((rule) => rule.nodes.map((node) => ({ target: node.target.map(String).join(' '), html: node.html.slice(0, 200), data: node.any[0]?.data ?? {} }))),
			incomplete: run.incomplete.reduce((total, rule) => total + rule.nodes.length, 0),
			passes: run.passes.reduce((total, rule) => total + rule.nodes.length, 0)
		};
	});
	return {
		violations: result.violations.map((node) => ({
			target: node.target,
			html: node.html,
			ratio: Number(node.data.contrastRatio ?? 0),
			expected: Number(String(node.data.expectedContrastRatio ?? '4.5').replace(':1', '')),
			foreground: String(node.data.fgColor ?? ''),
			background: String(node.data.bgColor ?? '')
		})),
		incomplete: result.incomplete,
		passes: result.passes
	};
}

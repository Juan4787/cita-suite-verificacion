import { expect, type Page } from '@playwright/test';

/** Longer whitespace-delimited tokens (emails, URLs, synthetic stress names) may legitimately wrap anywhere. */
export const ORDINARY_WORD_MAX_LENGTH = 20;

export type BrokenWord = { word: string; tag: string; lines: number; width: number };
export type LayoutIssue =
	| { check: 'zoom-blocked' | 'document-overflow' | 'framework-overlay' }
	| { check: 'control'; tag: string; name: string | null; left: number; right: number; width: number }
	| ({ check: 'broken-word' } & BrokenWord);

/**
 * Ordinary words that the layout splits across lines. `overflow-wrap: anywhere`
 * (declared globally in app.css so long names never widen the page) reduces the
 * min-content width of any text to one character: a squeezed flex/grid column
 * (a button beside a long heading, a badge beside a long name, a title beside a
 * progress row) then keeps the document inside the viewport while its words are
 * rendered letter by letter. Document overflow alone cannot detect that.
 * Breaks at hyphens/slashes are normal wrap opportunities and are not reported.
 */
export async function brokenOrdinaryWords(page: Page, scope = 'body'): Promise<BrokenWord[]> {
	return page.evaluate(
		({ scope, maxLength }) => {
			const broken: { word: string; tag: string; lines: number; width: number }[] = [];
			const seen = new Set<Text>();
			for (const root of document.querySelectorAll(scope)) {
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				for (let node = walker.nextNode(); node; node = walker.nextNode()) {
					const text = node as Text,
						parent = text.parentElement;
					if (!parent || seen.has(text)) continue;
					seen.add(text);
					if (parent.closest('script, style, template, noscript, select, option, textarea, svg')) continue;
					if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
					const box = parent.getBoundingClientRect();
					// Visually hidden text (sr-only, 1px native sources) is not read on screen.
					if (box.width <= 2 || box.height <= 2) continue;
					for (const token of text.data.matchAll(/\S+/g)) {
						if (token[0].length > maxLength) continue;
						for (const part of token[0].matchAll(/[^-‐‑–—/]+/g)) {
							if (part[0].length < 2) continue;
							const start = token.index + part.index;
							const range = document.createRange();
							range.setStart(text, start);
							range.setEnd(text, start + part[0].length);
							const tops = [...range.getClientRects()]
								.filter((rect) => rect.width > 0 && rect.height > 0)
								.map((rect) => rect.top)
								.sort((a, b) => a - b);
							const lines = tops.filter((top, index) => index === 0 || top - tops[index - 1] > 2).length;
							if (lines > 1)
								broken.push({ word: part[0], tag: parent.tagName.toLowerCase(), lines, width: Math.round(box.width) });
						}
					}
				}
			}
			return broken;
		},
		{ scope, maxLength: ORDINARY_WORD_MAX_LENGTH }
	);
}

/**
 * Shared rendered-layout contract for the UI matrices: browser zoom stays allowed,
 * the document does not scroll horizontally, every listed control is inside the
 * viewport with a usable width (checkboxes/radios are intrinsically small), no
 * framework overlay is shown and no ordinary word is broken by a squeezed column.
 * `controls` must name the operable controls of the task, not the 1px hidden
 * `.ux-native-source` inputs behind the custom calendars/selects.
 * Matrices may accumulate issues of every combination and assert them once, so a
 * failure reports all affected widths/themes instead of only the first one.
 */
export async function layoutIssues(page: Page, controls: string, textScope?: string): Promise<LayoutIssue[]> {
	const issues: LayoutIssue[] = [];
	if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[,\s]|$)/.test(
		(await page.locator('meta[name="viewport"]').getAttribute('content')) ?? ''
	))
		issues.push({ check: 'zoom-blocked' });
	if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)))
		issues.push({ check: 'document-overflow' });
	issues.push(
		...(await page.locator(controls).evaluateAll((elements) =>
			elements.flatMap((element) => {
				const r = element.getBoundingClientRect();
				const compact =
					element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio');
				return r.left < -1 || r.right > innerWidth + 1 || (!compact && r.width < 20)
					? [{ check: 'control' as const, tag: element.tagName.toLowerCase(), name: element.getAttribute('name'), left: r.left, right: r.right, width: r.width }]
					: [];
			})
		))
	);
	if (await page.locator('vite-error-overlay').count()) issues.push({ check: 'framework-overlay' });
	for (const word of await brokenOrdinaryWords(page, textScope)) issues.push({ check: 'broken-word', ...word });
	return issues;
}

export async function expectUsableLayout(page: Page, controls: string, textScope?: string) {
	expect(await layoutIssues(page, controls, textScope)).toEqual([]);
}

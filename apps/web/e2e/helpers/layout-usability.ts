import { expect, type Page } from '@playwright/test';

/** Longer whitespace-delimited tokens (emails, URLs, synthetic stress names) may legitimately wrap anywhere. */
export const ORDINARY_WORD_MAX_LENGTH = 20;
/** A control label up to this advance width fits on one line in any planned layout, including 320 px. */
export const SHORT_CONTROL_LABEL_WIDTH = 200;

export type BrokenWord = { word: string; tag: string; lines: number; width: number };
export type TextIssue =
	| ({ check: 'broken-word' } & BrokenWord)
	| { check: 'wrapped-control'; label: string; lines: number; width: number }
	| { check: 'split-quantity'; text: string }
	| { check: 'dangling-separator'; text: string }
	| { check: 'truncated-value'; tag: string; width: number }
	| { check: 'clipped-placeholder'; placeholder: string; width: number; available: number };
export type LayoutIssue =
	| { check: 'zoom-blocked' | 'document-overflow' | 'framework-overlay' }
	| { check: 'control'; tag: string; name: string | null; left: number; right: number; width: number }
	| TextIssue;

/**
 * Rendered-text legibility. `overflow-wrap: anywhere` (declared globally in app.css so
 * long names never widen the page) reduces the min-content width of any text to one
 * character, so a squeezed flex/grid column keeps the document inside the viewport
 * while it breaks words letter by letter, splits a short button label in two lines or
 * separates a number from its unit. Document overflow alone cannot detect any of them.
 * - broken-word: an ordinary word (≤ 20 characters) split across lines. Breaks at
 *   hyphens/slashes are normal wrap opportunities and are not reported.
 * - wrapped-control: a button, button-styled link or badge whose single-line label
 *   (≤ 200 px of text) is rendered on more than one line. Custom select triggers
 *   display a chosen value and may wrap it instead of truncating it.
 * - split-quantity: a number and its unit (minutes, hours, years, %, $ amount), or
 *   the two numbers of a counter ("Paso 3 de 5"), on different lines.
 * - dangling-separator: an inline separator (·) left at the end of a line, apart
 *   from the group it introduces.
 * - truncated-value: text inside the page content (`main` or a dialog) cut with an
 *   ellipsis, which hides what was chosen or who is involved. Header/navigation
 *   names and reviewed exceptions (`data-truncation="allowed"`) are not reported.
 * - clipped-placeholder: the hint of an empty input wider than the room its padding
 *   leaves for text, so the field shows it cut ("…DNI o teléfc"). An input cannot
 *   wrap its hint: the copy has to fit.
 * Hidden, sr-only and transparent text, native options and textareas are ignored.
 */
export async function textIssues(page: Page, scope = 'body'): Promise<TextIssue[]> {
	return page.evaluate(
		({ scope, maxLength, shortLabel }) => {
			type Found =
				| { check: 'broken-word'; word: string; tag: string; lines: number; width: number }
				| { check: 'wrapped-control'; label: string; lines: number; width: number }
				| { check: 'split-quantity'; text: string }
				| { check: 'dangling-separator'; text: string }
				| { check: 'truncated-value'; tag: string; width: number }
				| { check: 'clipped-placeholder'; placeholder: string; width: number; available: number };
			const issues: Found[] = [];
			const measure = document.createElement('canvas').getContext('2d');
			if (!measure) throw new Error('No canvas context to measure input hints.');
			const visible = (element: Element) => {
				if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
				const box = element.getBoundingClientRect();
				// Visually hidden text (sr-only, 1px native sources) is not read on screen.
				return box.width > 2 && box.height > 2;
			};
			const rectsOf = (text: Text, start: number, end: number) => {
				const range = document.createRange();
				range.setStart(text, start);
				range.setEnd(text, end);
				return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
			};
			// Distinct line boxes: a new line starts below half of the previous fragment.
			const lineCount = (rects: DOMRect[]) => {
				const sorted = [...rects].sort((a, b) => a.top - b.top);
				let lines = 0,
					lastTop = Number.NEGATIVE_INFINITY,
					lastHeight = 0;
				for (const rect of sorted)
					if (rect.top > lastTop + lastHeight / 2) {
						lines++;
						lastTop = rect.top;
						lastHeight = rect.height;
					}
				return lines;
			};
			// Number before a unit, currency sign before an amount, first number of a counter.
			const quantity =
				/(\d+(?:[.,]\d+)?)\s+(?=(?:minutos?|min|hs?|horas?|años?|%)(?![\p{L}\d]))|(\$)\s+(?=\d)|(\d+)\s+de\s+(?=\d)/gu;
			const roots = [...document.querySelectorAll(scope)];
			const seen = new Set<Text>();
			for (const root of roots) {
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				for (let node = walker.nextNode(); node; node = walker.nextNode()) {
					const text = node as Text,
						parent = text.parentElement;
					if (!parent || seen.has(text)) continue;
					seen.add(text);
					if (parent.closest('script, style, template, noscript, select, option, textarea, svg')) continue;
					if (!visible(parent)) continue;
					const width = Math.round(parent.getBoundingClientRect().width);
					for (const token of text.data.matchAll(/\S+/g)) {
						if (token[0].length > maxLength) continue;
						for (const part of token[0].matchAll(/[^-‐‑–—/]+/g)) {
							if (part[0].length < 2) continue;
							const start = token.index + part.index;
							const lines = lineCount(rectsOf(text, start, start + part[0].length));
							if (lines > 1)
								issues.push({ check: 'broken-word', word: part[0], tag: parent.tagName.toLowerCase(), lines, width });
						}
					}
					for (const match of text.data.matchAll(quantity)) {
						const headEnd = match.index + (match[1] ?? match[2] ?? match[3]).length;
						const end = match.index + match[0].length;
						// Last character of the leading number or sign and first character after the match.
						const before = rectsOf(text, headEnd - 1, headEnd);
						const after = rectsOf(text, end, Math.min(end + 1, text.data.length));
						if (before.length && after.length && Math.abs(before[0].top - after[0].top) > before[0].height / 2)
							issues.push({ check: 'split-quantity', text: text.data.slice(match.index, Math.min(end + 8, text.data.length)) });
					}
					for (const match of text.data.matchAll(/·\s+(?=\S)/g)) {
						const separator = rectsOf(text, match.index, match.index + 1);
						const next = rectsOf(text, match.index + match[0].length, match.index + match[0].length + 1);
						if (separator.length && next.length && Math.abs(separator[0].top - next[0].top) > separator[0].height / 2)
							issues.push({ check: 'dangling-separator', text: text.data.slice(Math.max(0, match.index - 12), match.index + match[0].length + 12) });
					}
				}
				const controls = root.querySelectorAll(
					'button, [role="button"], a[class*="ux-btn"], [class*="ux-badge"]'
				);
				for (const control of controls) {
					// A custom select trigger shows a value, not an action label: values wrap rather than truncate.
					if (!(control instanceof HTMLElement) || control.matches('.ux-control-trigger') || !visible(control)) continue;
					const label = control.innerText.trim();
					// Cards rendered as buttons hold several blocks of text; they are not labels.
					if (!label || label.includes('\n')) continue;
					const rects: DOMRect[] = [];
					const labelWalker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
					for (let node = labelWalker.nextNode(); node; node = labelWalker.nextNode()) {
						const text = node as Text;
						if (text.data.trim()) rects.push(...rectsOf(text, 0, text.data.length));
					}
					const advance = rects.reduce((sum, rect) => sum + rect.width, 0);
					const lines = lineCount(rects);
					if (lines > 1 && advance <= shortLabel)
						issues.push({
							check: 'wrapped-control',
							label: label.slice(0, 40),
							lines,
							width: Math.round(control.getBoundingClientRect().width)
						});
				}
				// Task content must not hide text behind an ellipsis. Header and navigation may
				// shorten names shown in full on the page; an explicit, reviewed exception
				// uses data-truncation="allowed".
				for (const element of root.querySelectorAll('*')) {
					if (!(element instanceof HTMLElement) || element.scrollWidth <= element.clientWidth + 1) continue;
					if (!element.closest('main, [role="dialog"]') || element.closest('[data-truncation="allowed"]')) continue;
					if (getComputedStyle(element).textOverflow !== 'ellipsis' || !visible(element)) continue;
					issues.push({
						check: 'truncated-value',
						tag: element.tagName.toLowerCase(),
						width: Math.round(element.getBoundingClientRect().width)
					});
				}
				for (const field of root.querySelectorAll('input[placeholder]')) {
					if (!(field instanceof HTMLInputElement) || !field.placeholder || field.value || !visible(field)) continue;
					const style = getComputedStyle(field);
					measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
					measure.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
					const width = measure.measureText(field.placeholder).width;
					const available = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
					if (width > available + 1)
						issues.push({
							check: 'clipped-placeholder',
							placeholder: field.placeholder,
							width: Math.round(width),
							available: Math.round(available)
						});
				}
			}
			return issues;
		},
		{ scope, maxLength: ORDINARY_WORD_MAX_LENGTH, shortLabel: SHORT_CONTROL_LABEL_WIDTH }
	);
}

/** Only the broken-word findings, kept for callers and the detector self-test. */
export async function brokenOrdinaryWords(page: Page, scope = 'body'): Promise<BrokenWord[]> {
	return (await textIssues(page, scope)).flatMap((issue) =>
		issue.check === 'broken-word'
			? [{ word: issue.word, tag: issue.tag, lines: issue.lines, width: issue.width }]
			: []
	);
}

/**
 * Shared rendered-layout contract for the UI matrices: browser zoom stays allowed,
 * the document does not scroll horizontally, every listed control is inside the
 * viewport with a usable width (checkboxes/radios are intrinsically small), no
 * framework overlay is shown and rendered text stays legible (see `textIssues`).
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
	issues.push(...(await textIssues(page, textScope)));
	return issues;
}

export async function expectUsableLayout(page: Page, controls: string, textScope?: string) {
	expect(await layoutIssues(page, controls, textScope)).toEqual([]);
}

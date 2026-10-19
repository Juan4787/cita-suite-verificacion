import { expect, type Locator } from '@playwright/test';

/** Capture the named task, including when a preceding long header is taller than the viewport. */
export async function alignTaskForCapture(anchor: Locator) {
	await anchor.scrollIntoViewIfNeeded();
	await anchor.evaluate((element) => {
		const inset = [...document.querySelectorAll('header')].reduce((maximum, header) => {
			const position = getComputedStyle(header).position;
			const box = header.getBoundingClientRect();
			return (position === 'sticky' || position === 'fixed') && box.top <= 1 && box.bottom > 0
				? Math.max(maximum, box.bottom)
				: maximum;
		}, 0);
		window.scrollTo({ top: Math.max(0, scrollY + element.getBoundingClientRect().top - inset - 16), behavior: 'instant' });
	});
	await expect(anchor).toBeInViewport();
}

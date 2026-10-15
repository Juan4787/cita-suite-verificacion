import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
vi.mock('$app/state', () => ({ page: { url: new URL('https://booking.example.test/'), data: {} } }));
import { page } from '$app/state';
import BookingAppearance from './BookingAppearance.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>Reserva</p>' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete document.documentElement.dataset.bookingColorMode; });

it.each(['light', 'dark'] as const)('renders the explicit %s mode without consulting the system', async (mode) => {
	page.data.bookingColorMode = mode;
	const matchMedia = vi.fn(() => { throw new Error('System preference must not override the site.'); });
	vi.stubGlobal('matchMedia', matchMedia);
	const { container } = render(BookingAppearance, { theme: 'natalia', children });
	expect(container.querySelector('.booking-natalia')).toHaveAttribute('data-booking-color-mode', mode);
	await waitFor(() => expect(document.documentElement.dataset.bookingColorMode).toBe(mode));
	expect(matchMedia).not.toHaveBeenCalled();
});

it('does not apply Natalia colors to the standard Cita Suite appearance', () => {
	const { container } = render(BookingAppearance, { theme: 'cita-suite', children });
	expect(container.querySelector('.booking-surface')).not.toHaveAttribute('data-booking-color-mode');
	expect(document.documentElement.dataset.bookingColorMode).toBeUndefined();
});

it('leaves the embedded host bridge in control of the mode', () => {
	page.url.searchParams.set('parent_origin', 'https://host.example.test');
	page.url.searchParams.set('instance_id', 'a'.repeat(32));
	const parent = window.parent;
	Object.defineProperty(window, 'parent', { value: {}, configurable: true });
	try {
		page.data.bookingColorMode = 'dark';
		const { container } = render(BookingAppearance, { theme: 'natalia', children });
		expect(container.querySelector('.booking-natalia')).not.toHaveAttribute('data-booking-color-mode');
		expect(document.documentElement.dataset.bookingColorMode).toBeUndefined();
	} finally {
		Object.defineProperty(window, 'parent', { value: parent, configurable: true });
		page.url.search = '';
	}
});

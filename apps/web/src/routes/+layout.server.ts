import type { LayoutServerLoad } from './$types';

// A display preference only: shared by the native booking and its management pages.
// Embedded integrations continue to receive their mode from the existing host bridge.
export const load: LayoutServerLoad = ({ url, cookies }) => {
	const requested = url.searchParams.get('color_mode');
	const valid = (value: string | null | undefined): value is 'light' | 'dark' =>
		value === 'light' || value === 'dark';
	const saved = cookies.get('booking-color-mode');
	const bookingColorMode = valid(requested) ? requested : valid(saved) ? saved : 'light';
	if (valid(requested) && requested !== saved) {
		cookies.set('booking-color-mode', requested, {
			path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 30
		});
	}
	return { bookingColorMode };
};

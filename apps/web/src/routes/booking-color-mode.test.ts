import { describe, expect, it, vi } from 'vitest';
import { load } from './+layout.server';

function request(query = '', saved?: string) {
	const cookies = { get: vi.fn(() => saved), set: vi.fn() };
	const result = load({ url: new URL('https://booking.example.test/' + query), cookies } as unknown as Parameters<typeof load>[0]);
	return { result, cookies };
}

describe('native booking appearance preference', () => {
	it('defaults to light without a website preference', () => {
		const { result, cookies } = request();
		expect(result).toEqual({ bookingColorMode: 'light' });
		expect(cookies.set).not.toHaveBeenCalled();
	});
	it.each(['light', 'dark'])('preserves an explicit %s choice through later pages', (mode) => {
		const { result, cookies } = request('?color_mode=' + mode, mode === 'dark' ? 'light' : 'dark');
		expect(result).toEqual({ bookingColorMode: mode });
		expect(cookies.set).toHaveBeenCalledWith('booking-color-mode', mode, expect.objectContaining({
			path: '/', httpOnly: true, sameSite: 'lax', secure: true
		}));
		expect(request('', mode).result).toEqual({ bookingColorMode: mode });
	});
	it('ignores invalid values without overwriting a valid preference', () => {
		expect(request('?color_mode=system', 'dark').result).toEqual({ bookingColorMode: 'dark' });
		const { result, cookies } = request('?color_mode=invalid', 'invalid');
		expect(result).toEqual({ bookingColorMode: 'light' });
		expect(cookies.set).not.toHaveBeenCalled();
	});
	it('does not reissue an unchanged preference', () => {
		expect(request('?color_mode=light', 'light').cookies.set).not.toHaveBeenCalled();
	});
});

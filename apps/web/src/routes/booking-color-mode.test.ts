import { describe, expect, it, vi } from 'vitest';
import { load } from './+layout.server';

// The root layout reads two independent preferences: the website's mode for the native booking
// (`booking-color-mode`) and the app's own color mode of the device (`cita-theme`, light by default).
function request(query = '', saved?: string, theme?: string) {
	const values: Record<string, string | undefined> = { 'booking-color-mode': saved, 'cita-theme': theme };
	const cookies = { get: vi.fn((name: string) => values[name]), set: vi.fn() };
	const result = load({ url: new URL('https://booking.example.test/' + query), cookies } as unknown as Parameters<typeof load>[0]);
	return { result, cookies };
}

describe('native booking appearance preference', () => {
	it('defaults to light without a website preference', () => {
		const { result, cookies } = request();
		expect(result).toEqual({ bookingColorMode: 'light', themePreference: 'light' });
		expect(cookies.set).not.toHaveBeenCalled();
	});
	it.each(['light', 'dark'])('preserves an explicit %s choice through later pages', (mode) => {
		const { result, cookies } = request('?color_mode=' + mode, mode === 'dark' ? 'light' : 'dark');
		expect(result).toEqual({ bookingColorMode: mode, themePreference: 'light' });
		expect(cookies.set).toHaveBeenCalledWith('booking-color-mode', mode, expect.objectContaining({
			path: '/', httpOnly: true, sameSite: 'lax', secure: true
		}));
		expect(request('', mode).result).toEqual({ bookingColorMode: mode, themePreference: 'light' });
	});
	it('ignores invalid values without overwriting a valid preference', () => {
		expect(request('?color_mode=system', 'dark').result).toEqual({ bookingColorMode: 'dark', themePreference: 'light' });
		const { result, cookies } = request('?color_mode=invalid', 'invalid');
		expect(result).toEqual({ bookingColorMode: 'light', themePreference: 'light' });
		expect(cookies.set).not.toHaveBeenCalled();
	});
	it('does not reissue an unchanged preference', () => {
		expect(request('?color_mode=light', 'light').cookies.set).not.toHaveBeenCalled();
	});
});

describe('app color mode of the device', () => {
	it.each([
		[undefined, 'light'],
		['light', 'light'],
		['dark', 'dark'],
		['system', 'system'],
		['oscuro', 'light']
	])('reads cita-theme=%s as %s', (theme, expected) => {
		expect(request('', undefined, theme).result).toEqual({ bookingColorMode: 'light', themePreference: expected });
	});
	it('keeps the website mode and the app mode independent of each other', () => {
		const { result, cookies } = request('?color_mode=light', 'light', 'dark');
		expect(result).toEqual({ bookingColorMode: 'light', themePreference: 'dark' });
		expect(request('', 'dark', 'light').result).toEqual({ bookingColorMode: 'dark', themePreference: 'light' });
		// Reading the app mode never writes a cookie: only the selector does.
		expect(cookies.set).not.toHaveBeenCalled();
	});
});

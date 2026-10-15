import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	loadAppointmentForToken: vi.fn(),
	createGoogleCalendarAuthorizationUrl: vi.fn()
}));
vi.mock('$lib/server/appointment-token', () => ({
	loadAppointmentForToken: mocks.loadAppointmentForToken
}));
vi.mock('$lib/server/google-calendar', () => ({
	createGoogleCalendarAuthorizationUrl: mocks.createGoogleCalendarAuthorizationUrl
}));

const { GET } = await import('./+server');

const callGet = (url = 'https://app.test/turno/token/google-calendar/connect') =>
	GET({
		params: { token: 'token' },
		fetch: vi.fn(),
		url: new URL(url)
	} as unknown as Parameters<typeof GET>[0]);

beforeEach(() => {
	vi.clearAllMocks();
	mocks.loadAppointmentForToken.mockResolvedValue({
		appointment: { id: 'appointment', is_past: false },
		supabase: { admin: true },
		demo: false
	});
	mocks.createGoogleCalendarAuthorizationUrl.mockResolvedValue(
		'https://accounts.google.com/o/oauth2/v2/auth?state=opaque'
	);
});

describe('inicio público de Google Calendar', () => {
	it('sale del sitio únicamente hacia la URL OAuth creada por el servidor', async () => {
		const response = await callGet();
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			'https://accounts.google.com/o/oauth2/v2/auth?state=opaque'
		);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mocks.createGoogleCalendarAuthorizationUrl).toHaveBeenCalledWith(
			{ admin: true },
			{ id: 'appointment', is_past: false },
			{ forceConsent: false }
		);
	});

	it('solo fuerza consentimiento después de una reconexión explícita', async () => {
		await callGet('https://app.test/turno/token/google-calendar/connect?reauthorize=1');
		expect(mocks.createGoogleCalendarAuthorizationUrl).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			{ forceConsent: true }
		);
	});

	it('no inicia OAuth con un turno vencido, inexistente o de demostración', async () => {
		for (const context of [
			{ appointment: null, supabase: { admin: true }, demo: false },
			{ appointment: { id: 'appointment', is_past: true }, supabase: { admin: true }, demo: false },
			{ appointment: { id: 'appointment', is_past: false }, supabase: null, demo: true }
		]) {
			mocks.loadAppointmentForToken.mockResolvedValueOnce(context);
			const response = await callGet();
			expect(response.headers.get('location')).toBe('/turno/token?calendar=unavailable');
		}
		expect(mocks.createGoogleCalendarAuthorizationUrl).not.toHaveBeenCalled();
	});
});

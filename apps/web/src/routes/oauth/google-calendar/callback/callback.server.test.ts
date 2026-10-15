import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	consumeGoogleCalendarOAuthAttempt: vi.fn(),
	authorizeGoogleCalendarAppointment: vi.fn(),
	processGoogleCalendarEvent: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock('$lib/server/google-calendar', () => ({
	consumeGoogleCalendarOAuthAttempt: mocks.consumeGoogleCalendarOAuthAttempt,
	authorizeGoogleCalendarAppointment: mocks.authorizeGoogleCalendarAppointment,
	processGoogleCalendarEvent: mocks.processGoogleCalendarEvent
}));

const { GET } = await import('./+server');

const supabase = {
	from: () => {
		const chain: any = {};
		for (const method of ['select', 'eq']) chain[method] = () => chain;
		chain.maybeSingle = async () => ({
			data: { confirmation_token: 'appointment-token' },
			error: null
		});
		return chain;
	}
};

const callGet = (query: string) =>
	GET({
		url: new URL(`https://app.test/oauth/google-calendar/callback?${query}`),
		fetch: vi.fn()
	} as unknown as Parameters<typeof GET>[0]);

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createSupabaseAdminClient.mockResolvedValue(supabase);
	mocks.consumeGoogleCalendarOAuthAttempt.mockResolvedValue({
		attemptId: 'attempt',
		businessId: 'business',
		appointmentId: 'appointment',
		codeVerifier: 'verifier',
		forceConsent: false
	});
	mocks.authorizeGoogleCalendarAppointment.mockResolvedValue({
		appointmentId: 'appointment',
		eventRowId: 'event-row',
		accessToken: 'access-token'
	});
	mocks.processGoogleCalendarEvent.mockResolvedValue({ status: 'active' });
});

describe('callback OAuth Google Calendar', () => {
	it('consume state antes de intercambiar el código y vuelve sin credenciales en la URL', async () => {
		const response = await callGet('state=opaque-state&code=authorization-code');
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			'/turno/appointment-token?calendar=connected'
		);
		expect(response.headers.get('location')).not.toContain('authorization-code');
		expect(response.headers.get('location')).not.toContain('opaque-state');
		expect(mocks.consumeGoogleCalendarOAuthAttempt).toHaveBeenCalledWith(
			supabase,
			'opaque-state'
		);
		expect(mocks.authorizeGoogleCalendarAppointment).toHaveBeenCalledWith(
			supabase,
			expect.objectContaining({ appointmentId: 'appointment' }),
			'authorization-code',
			expect.any(Function)
		);
		expect(mocks.processGoogleCalendarEvent).toHaveBeenCalledWith(
			supabase,
			'event-row',
			expect.any(Function),
			{ accessToken: 'access-token' }
		);
	});

	it('una negativa del usuario no crea ni modifica eventos', async () => {
		const response = await callGet('state=opaque-state&error=access_denied');
		expect(response.headers.get('location')).toBe(
			'/turno/appointment-token?calendar=cancelled'
		);
		expect(mocks.authorizeGoogleCalendarAppointment).not.toHaveBeenCalled();
		expect(mocks.processGoogleCalendarEvent).not.toHaveBeenCalled();
	});

	it('presenta un estado sereno cuando la creación quedó en reintento', async () => {
		mocks.processGoogleCalendarEvent.mockResolvedValue({ status: 'pending_create' });
		const response = await callGet('state=opaque-state&code=authorization-code');
		expect(response.headers.get('location')).toBe(
			'/turno/appointment-token?calendar=preparing'
		);
	});

	it('rechaza state inválido sin revelar datos del turno', async () => {
		mocks.consumeGoogleCalendarOAuthAttempt.mockRejectedValue(
			new Error('GOOGLE_CALENDAR_OAUTH_STATE_INVALID')
		);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const response = await callGet('state=invalido&code=no-importa');
			expect(response.status).toBe(400);
			await expect(response.text()).resolves.toBe('Este enlace ya no está disponible.');
			expect(mocks.authorizeGoogleCalendarAppointment).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});
});

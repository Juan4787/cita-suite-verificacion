import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	canRegisterCalendarAction: vi.fn(),
	googleCalendarUrlFor: vi.fn(),
	icsForAppointment: vi.fn(),
	loadAppointmentForToken: vi.fn(),
	recordCalendarAction: vi.fn(),
	uncachedRedirect: vi.fn()
}));

vi.mock('$lib/server/appointment-token', () => ({
	loadAppointmentForToken: mocks.loadAppointmentForToken,
	uncachedRedirect: mocks.uncachedRedirect
}));
vi.mock('$lib/server/calendar-content', () => ({
	googleCalendarUrlFor: mocks.googleCalendarUrlFor,
	icsForAppointment: mocks.icsForAppointment
}));
vi.mock('$lib/server/calendar-tracking', () => ({
	canRegisterCalendarAction: mocks.canRegisterCalendarAction,
	recordCalendarAction: mocks.recordCalendarAction
}));

const { GET: openGoogleCalendar } = await import('./ir/google/+server');
const { GET: openPhoneCalendar } = await import('./calendario.ics/+server');

const appointment = {
	id: 'appointment-id',
	is_past: false,
	status: 'reserved',
	business: { id: 'business-id' }
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.canRegisterCalendarAction.mockReturnValue(true);
	mocks.loadAppointmentForToken.mockResolvedValue({
		appointment,
		supabase: { admin: true },
		demo: false
	});
	mocks.googleCalendarUrlFor.mockReturnValue(
		'https://calendar.google.com/calendar/render?action=TEMPLATE'
	);
	mocks.icsForAppointment.mockReturnValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
	mocks.recordCalendarAction.mockResolvedValue(undefined);
	mocks.uncachedRedirect.mockImplementation(
		(location: string) =>
			new Response(null, {
				status: 303,
				headers: { location, 'cache-control': 'no-store' }
			})
	);
});

describe('entrega observable a calendarios externos', () => {
	it('registra el inicio de Google antes de redirigir al editor prearmado', async () => {
		const response = await openGoogleCalendar({
			params: { token: 'public-token' },
			fetch: vi.fn(),
			url: new URL('https://app.test/turno/public-token/ir/google')
		} as unknown as Parameters<typeof openGoogleCalendar>[0]);

		expect(mocks.recordCalendarAction).toHaveBeenCalledWith(
			{ admin: true },
			appointment,
			'clicked_google',
			{ source: null }
		);
		expect(mocks.recordCalendarAction.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.uncachedRedirect.mock.invocationCallOrder[0]
		);
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			'https://calendar.google.com/calendar/render?action=TEMPLATE'
		);
	});

	it('registra iPhone antes de entregar el evento inline al calendario', async () => {
		const response = await openPhoneCalendar({
			params: { token: 'public-token' },
			fetch: vi.fn(),
			url: new URL('https://app.test/turno/public-token/calendario.ics?p=phone')
		} as unknown as Parameters<typeof openPhoneCalendar>[0]);

		expect(mocks.recordCalendarAction).toHaveBeenCalledWith(
			{ admin: true },
			appointment,
			'clicked_phone_calendar'
		);
		expect(mocks.recordCalendarAction.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.icsForAppointment.mock.invocationCallOrder[0]
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/calendar');
		expect(response.headers.get('content-disposition')).toBe('inline; filename="turno.ics"');
	});

	it('no registra acciones de calendario en el modo demostración', async () => {
		mocks.loadAppointmentForToken.mockResolvedValueOnce({
			appointment,
			supabase: null,
			demo: true
		});

		await openPhoneCalendar({
			params: { token: 'public-token' },
			fetch: vi.fn(),
			url: new URL('https://app.test/turno/public-token/calendario.ics?p=phone')
		} as unknown as Parameters<typeof openPhoneCalendar>[0]);

		expect(mocks.recordCalendarAction).not.toHaveBeenCalled();
	});
});

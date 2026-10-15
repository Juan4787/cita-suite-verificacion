import { describe, expect, it } from 'vitest';
import { buildGoogleCalendarUrl, buildOutlookUrl, type CalendarLinkInput } from './calendar-links';

const input: CalendarLinkInput = {
	title: 'Turno en Clínica Sabrina',
	startsAt: new Date('2026-06-15T17:30:00.000Z'),
	endsAt: new Date('2026-06-15T18:00:00.000Z'),
	details: 'Dirección: Av. Santa Fe 1234\nVer turno: https://app.cita-suite.workers.dev/turno/tok',
	location: 'Av. Santa Fe 1234, CABA',
	timezone: 'America/Argentina/Cordoba'
};

describe('buildGoogleCalendarUrl', () => {
	it('arma el template con fechas UTC compactas y ctz', () => {
		const url = new URL(buildGoogleCalendarUrl(input));
		expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
		expect(url.searchParams.get('action')).toBe('TEMPLATE');
		expect(url.searchParams.get('text')).toBe('Turno en Clínica Sabrina');
		expect(url.searchParams.get('dates')).toBe('20260615T173000Z/20260615T180000Z');
		expect(url.searchParams.get('ctz')).toBe('America/Argentina/Cordoba');
		expect(url.searchParams.get('location')).toBe('Av. Santa Fe 1234, CABA');
		expect(url.searchParams.get('details')).toContain('Ver turno:');
	});

	it('omite location si es null', () => {
		const url = new URL(buildGoogleCalendarUrl({ ...input, location: null }));
		expect(url.searchParams.has('location')).toBe(false);
	});
});

describe('buildOutlookUrl', () => {
	it('arma el deeplink de composición con fechas ISO UTC', () => {
		const url = new URL(buildOutlookUrl(input));
		expect(url.origin + url.pathname).toBe('https://outlook.live.com/calendar/deeplink/compose');
		expect(url.searchParams.get('subject')).toBe('Turno en Clínica Sabrina');
		expect(url.searchParams.get('startdt')).toBe('2026-06-15T17:30:00Z');
		expect(url.searchParams.get('enddt')).toBe('2026-06-15T18:00:00Z');
		expect(url.searchParams.get('rru')).toBe('addevent');
	});
});

// Links de "agregar a calendario" por proveedor (sin OAuth).
// Google: fechas en UTC + ctz con la zona del consultorio. OJO: el template de Google
// NO acepta recordatorios personalizados; el usuario recibe sus defaults.
// Outlook: deeplink de composición de outlook.live.com (cuentas personales).

const compactUtc = (date: Date) =>
	date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const isoUtcNoMs = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

export type CalendarLinkInput = {
	title: string;
	startsAt: Date;
	endsAt: Date;
	details: string;
	location: string | null;
	timezone: string;
};

export const buildGoogleCalendarUrl = (input: CalendarLinkInput): string => {
	const params = new URLSearchParams({
		action: 'TEMPLATE',
		text: input.title,
		dates: `${compactUtc(input.startsAt)}/${compactUtc(input.endsAt)}`,
		details: input.details,
		ctz: input.timezone
	});
	if (input.location) params.set('location', input.location);
	return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

export const buildOutlookUrl = (input: CalendarLinkInput): string => {
	const params = new URLSearchParams({
		path: '/calendar/action/compose',
		rru: 'addevent',
		subject: input.title,
		startdt: isoUtcNoMs(input.startsAt),
		enddt: isoUtcNoMs(input.endsAt),
		body: input.details
	});
	if (input.location) params.set('location', input.location);
	return `https://outlook.live.com/calendar/deeplink/compose?${params.toString()}`;
};

// Contenido del evento de calendario a partir de la vista pública del turno.
// Reglas de privacidad: el evento puede aparecer en pantalla bloqueada, smartwatch o
// calendarios compartidos. Título y descripción neutrales: NUNCA el servicio, ni el
// nombre del paciente, ni datos clínicos.

import { formatInTimeZone } from '$lib/utils/format';
import { alarmsForProximity, buildIcs } from './ics';
import { buildGoogleCalendarUrl, buildOutlookUrl, type CalendarLinkInput } from './calendar-links';
import { getPublicSiteUrl, publicAppointmentUrl } from './messaging';
import type { PublicAppointmentView } from './public-appointments';

export const calendarSummaryFor = (appointment: PublicAppointmentView): string =>
	`Turno en ${appointment.business.name}`;

export const calendarLocationFor = (appointment: PublicAppointmentView): string | null => {
	if (appointment.booking_context?.modality === 'video') return 'Consulta virtual';
	const address = appointment.business.address?.trim();
	if (!address) return null;
	const instructions = appointment.business.address_instructions?.trim();
	return instructions ? `${address} · ${instructions}` : address;
};

export const calendarDescriptionFor = (appointment: PublicAppointmentView): string => {
	const { dateLabel, timeLabel } = formatInTimeZone(
		appointment.starts_at,
		appointment.business.timezone
	);
	const lines = [
		'Tenés un turno reservado.',
		'',
		`Fecha: ${dateLabel}`,
		`Hora local del consultorio: ${timeLabel}`,
		`Profesional: ${appointment.professional_name_snapshot}`,
		`Consultorio: ${appointment.business.name}`
	];
	if (appointment.booking_context?.modality !== 'video' && appointment.business.address) lines.push(`Dirección: ${appointment.business.address}`);
	if (appointment.booking_context?.modality === 'video') lines.push('Modalidad: Virtual');
	if (appointment.business.address_instructions) {
		lines.push(`Indicaciones: ${appointment.business.address_instructions}`);
	}
	if (appointment.booking_context?.modality !== 'video' && appointment.business.maps_link) lines.push(`Cómo llegar: ${appointment.business.maps_link}`);
	lines.push(`Ver turno: ${publicAppointmentUrl(appointment.token)}`);
	return lines.join('\n');
};

export const icsForAppointment = (
	appointment: PublicAppointmentView,
	options: { now?: Date } = {}
): string => {
	const now = options.now ?? new Date();
	const startsAt = new Date(appointment.starts_at);
	const endsAt = new Date(appointment.ends_at);
	const host = new URL(getPublicSiteUrl()).hostname;
	const cancelled = appointment.status === 'cancelled';

	return buildIcs({
		// UID estable por turno: reimportar el mismo turno actualiza en vez de duplicar
		// (en los calendarios que respetan UID+SEQUENCE).
		uid: `appointment-${appointment.id}@${host}`,
		startsAt,
		endsAt,
		summary: calendarSummaryFor(appointment),
		description: calendarDescriptionFor(appointment),
		location: calendarLocationFor(appointment),
		url: publicAppointmentUrl(appointment.token),
		sequence: cancelled ? appointment.calendar_sequence + 1 : appointment.calendar_sequence,
		status: cancelled ? 'CANCELLED' : 'CONFIRMED',
		method: cancelled ? 'CANCEL' : 'PUBLISH',
		alarms: cancelled ? [] : alarmsForProximity(startsAt, now),
		now
	});
};

const calendarLinkInputFor = (appointment: PublicAppointmentView): CalendarLinkInput => ({
	title: calendarSummaryFor(appointment),
	startsAt: new Date(appointment.starts_at),
	endsAt: new Date(appointment.ends_at),
	details: calendarDescriptionFor(appointment),
	location: calendarLocationFor(appointment),
	timezone: appointment.business.timezone
});

export const googleCalendarUrlFor = (appointment: PublicAppointmentView): string =>
	buildGoogleCalendarUrl(calendarLinkInputFor(appointment));

export const outlookUrlFor = (appointment: PublicAppointmentView): string =>
	buildOutlookUrl(calendarLinkInputFor(appointment));

// Texto para "Copiar detalles del turno" (fallback cuando el calendario no abre bien).
export const copyDetailsTextFor = (appointment: PublicAppointmentView): string =>
	calendarDescriptionFor(appointment);

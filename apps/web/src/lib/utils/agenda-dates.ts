// Etiquetas de fecha y hora de la agenda diaria, siempre en la zona del consultorio:
// el navegador de quien mira puede estar en otra (CI en UTC, un viaje, una laptop mal configurada).
import { zonedDate } from '$lib/availability/calculate';

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const yearFormatters = new Map<string, Intl.DateTimeFormat>();

const formatter = (cache: Map<string, Intl.DateTimeFormat>, timeZone: string, options: Intl.DateTimeFormatOptions) => {
	let value = cache.get(timeZone);
	if (!value) {
		value = new Intl.DateTimeFormat('es-AR', { ...options, timeZone });
		cache.set(timeZone, value);
	}
	return value;
};

/** Hora del turno (HH:MM, medianoche como 00:00). */
export const agendaTime = (value: string, timeZone: string) =>
	formatter(timeFormatters, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));

/** Día del turno (YYYY-MM-DD) en el calendario del consultorio. */
export const agendaDateOf = (value: string, timeZone: string) => zonedDate(new Date(value), timeZone);

/** «vie, 6 nov», con el año sólo si no es el año en curso del consultorio. */
export const agendaShortDayLabel = (value: string, timeZone: string, now: Date = new Date()) => {
	const date = new Date(value);
	const label = formatter(dayFormatters, timeZone, { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
	const year = formatter(yearFormatters, timeZone, { year: 'numeric' });
	const shownYear = year.format(date);
	return shownYear === year.format(now) ? label : `${label} ${shownYear}`;
};

const longDateFormatters = new Map<string, Intl.DateTimeFormat>();

/** «6 de noviembre de 2026». */
export const agendaLongDate = (value: string, timeZone: string) =>
	formatter(longDateFormatters, timeZone, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));

/** Hoy (YYYY-MM-DD) en el consultorio. */
export const agendaToday = (timeZone: string, now: Date = new Date()) => zonedDate(now, timeZone);

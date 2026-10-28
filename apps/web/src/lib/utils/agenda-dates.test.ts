import { describe, expect, it } from 'vitest';
import { agendaDateOf, agendaLongDate, agendaShortDayLabel, agendaTime, agendaToday } from './agenda-dates';

// La agenda muestra la hora del consultorio, no la del navegador. El consultorio
// de estas pruebas está en Tokio (UTC+9, sin horario de verano), una zona que no
// coincide con la de las máquinas donde corren (Argentina o UTC).
const tokyo = 'Asia/Tokyo';

describe('agenda-dates', () => {
	it('corre en una zona distinta de la del consultorio, para poder detectar el defecto', () => {
		expect(new Date('2026-11-06T00:00:00Z').getTimezoneOffset()).not.toBe(-540);
	});

	it('muestra la hora del turno en la zona del consultorio', () => {
		expect(agendaTime('2026-11-06T00:00:00Z', tokyo)).toBe('09:00');
		expect(agendaTime('2026-11-06T14:30:00Z', tokyo)).toBe('23:30');
	});

	it('ubica el turno en el día del consultorio', () => {
		expect(agendaDateOf('2026-11-05T16:00:00Z', tokyo)).toBe('2026-11-06');
	});

	it('etiqueta el día del consultorio', () => {
		const now = new Date('2026-10-28T03:00:00Z');
		expect(agendaShortDayLabel('2026-11-05T16:00:00Z', tokyo, now)).toBe(
			agendaShortDayLabel('2026-11-06T05:00:00Z', tokyo, now)
		);
		expect(agendaShortDayLabel('2026-11-05T16:00:00Z', tokyo, now)).toMatch(/\b6\b/);
		expect(agendaShortDayLabel('2026-12-31T16:00:00Z', tokyo, now)).toMatch(/2027/);
		expect(agendaShortDayLabel('2026-12-31T05:00:00Z', tokyo, now)).not.toMatch(/2027/);
	});

	it('muestra la fecha larga del turno en el día del consultorio', () => {
		expect(agendaLongDate('2026-12-31T16:00:00Z', tokyo)).toBe('1 de enero de 2027');
	});

	it('calcula hoy en la zona del consultorio', () => {
		expect(agendaToday(tokyo, new Date('2026-10-27T20:00:00Z'))).toBe('2026-10-28');
	});
});

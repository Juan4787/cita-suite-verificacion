import { describe, expect, it } from 'vitest';
import { formatAccessRemaining, formatDate, formatDateTime, formatInTimeZone } from './format';

// Caso que rompía sin timezone: 21:30 ART = 00:30 UTC del día SIGUIENTE.
// En SSR, cuando el runtime usa UTC, la fecha aparecía corrida un día.
const lateEvening = '2026-06-16T00:30:00.000Z';

describe('formatDateTime con timezone', () => {
	it('muestra la hora local del negocio aunque cruce medianoche UTC', () => {
		const label = formatDateTime(lateEvening, 'America/Argentina/Cordoba');
		expect(label).toContain('15 de junio');
		expect(label).toContain('21:30');
	});

	it('sin timezone mantiene el comportamiento previo (zona del runtime)', () => {
		expect(formatDateTime(lateEvening)).toBeTruthy();
		expect(formatDateTime(null)).toBe('');
	});
});

describe('formatDate con timezone', () => {
	it('respeta la fecha local del negocio', () => {
		expect(formatDate(lateEvening, 'America/Argentina/Cordoba')).toContain('15 de junio');
	});

	it('conserva el día de las fechas sin hora', () => {
		expect(formatDate('2004-02-03')).toContain('3 de febrero');
		expect(formatDate('2004-02-03', 'America/Argentina/Cordoba')).toContain('3 de febrero');
	});
});

describe('formatInTimeZone', () => {
	it('devuelve etiquetas de día y hora en la zona del negocio', () => {
		const labels = formatInTimeZone(lateEvening, 'America/Argentina/Cordoba');
		expect(labels.dateLabel).toContain('15 de junio');
		expect(labels.timeLabel).toBe('21:30');
		expect(labels.full).toBe(`${labels.dateLabel} a las ${labels.timeLabel}`);
	});

	it('representa la medianoche como 00:00 y nunca como 24:00', () => {
		const midnight = '2026-08-15T03:00:00.000Z';
		const labels = formatInTimeZone(midnight, 'America/Argentina/Cordoba');
		expect(labels.timeLabel).toBe('00:00');
		expect(labels.full).not.toContain('24:00');
		expect(formatDateTime(midnight, 'America/Argentina/Cordoba')).toContain('00:00');
	});
});

describe('formatAccessRemaining', () => {
	const now = new Date('2026-07-10T12:00:00.000Z');

	it('mantiene una habilitación de una hora expresada en horas, no en días', () => {
		expect(formatAccessRemaining('2026-07-10T13:00:00.000Z', now)).toBe('1 hora restante');
		expect(formatAccessRemaining('2026-07-10T12:59:59.000Z', now)).toBe('1 hora restante');
	});

	it('usa minutos para accesos cortos y días recién desde las 24 horas', () => {
		expect(formatAccessRemaining('2026-07-10T12:35:00.000Z', now)).toBe('35 min restantes');
		expect(formatAccessRemaining('2026-07-11T12:00:00.000Z', now)).toBe('1 día restante');
	});

	it('informa vencimiento y tolera valores vacíos o inválidos', () => {
		expect(formatAccessRemaining('2026-07-10T11:59:59.000Z', now)).toBe('Vencido');
		expect(formatAccessRemaining(null, now)).toBeNull();
		expect(formatAccessRemaining('fecha-inválida', now)).toBeNull();
	});
});

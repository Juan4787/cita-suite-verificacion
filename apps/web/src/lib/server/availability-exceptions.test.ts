import { describe, expect, it } from 'vitest';
import { normalizeAvailabilityDate, parseAvailabilityExceptionInterval } from './availability-exceptions';

const timeZone = 'America/Argentina/Buenos_Aires';

describe('availability exception intervals', () => {
	it('mantiene el bloqueo puntual de un solo día y horario', () => {
		const result = parseAvailabilityExceptionInterval({
			type: 'blocked',
			periodMode: 'single',
			date: '12/07/2026',
			timeRange: '10 a 12',
			timeZone
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.startsAt.toISOString()).toBe('2026-07-12T13:00:00.000Z');
		expect(result.endsAt.toISOString()).toBe('2026-07-12T15:00:00.000Z');
	});

	it('bloquea un rango completo incluyendo Desde y Hasta', () => {
		const result = parseAvailabilityExceptionInterval({
			type: 'blocked',
			periodMode: 'range',
			dateFrom: '2026-07-12',
			dateTo: '2026-07-19',
			timeZone
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.startDate).toBe('2026-07-12');
		expect(result.endDate).toBe('2026-07-19');
		expect(result.startsAt.toISOString()).toBe('2026-07-12T03:00:00.000Z');
		expect(result.endsAt.toISOString()).toBe('2026-07-20T03:00:00.000Z');
	});

	it('permite elegir la misma fecha como rango de un día completo', () => {
		const result = parseAvailabilityExceptionInterval({
			type: 'blocked',
			periodMode: 'range',
			dateFrom: '2026-07-12',
			dateTo: '2026-07-12',
			timeZone
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.endsAt.toISOString()).toBe('2026-07-13T03:00:00.000Z');
	});

	it('rechaza un Hasta anterior a Desde', () => {
		const result = parseAvailabilityExceptionInterval({
			type: 'blocked',
			periodMode: 'range',
			dateFrom: '2026-07-19',
			dateTo: '2026-07-12',
			timeZone
		});

		expect(result).toEqual({ ok: false, message: 'La fecha Hasta no puede ser anterior a Desde.' });
	});

	it('no permite convertir un rango en horario extra ambiguo', () => {
		const result = parseAvailabilityExceptionInterval({
			type: 'extra_available',
			periodMode: 'range',
			dateFrom: '2026-07-12',
			dateTo: '2026-07-19',
			timeZone
		});

		expect(result).toEqual({
			ok: false,
			message: 'Los rangos de fechas están disponibles sólo para bloqueos.'
		});
	});

	it('rechaza fechas de calendario inexistentes', () => {
		expect(normalizeAvailabilityDate('31/02/2026')).toBe('');
		expect(normalizeAvailabilityDate('2026-02-31')).toBe('');
	});
});

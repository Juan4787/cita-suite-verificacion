import { describe, expect, it } from 'vitest';
import {
	createdAppointmentDetailUrl,
	shouldOfferCreatedAppointmentActivation
} from './agenda-navigation';

describe('createdAppointmentDetailUrl', () => {
	it('lleva al detalle con la fecha de regreso y el último paso visible', () => {
		const url = createdAppointmentDetailUrl('appointment-1', '2026-08-20');
		expect(url).toBe(
			'/odonto/turnos/appointment-1?from_date=2026-08-20&created=1'
		);
	});

	it('no permite que un identificador altere la ruta', () => {
		expect(createdAppointmentDetailUrl('../otro', '2026-08-20')).toContain(
			'/odonto/turnos/..%2Fotro?'
		);
	});
});

describe('shouldOfferCreatedAppointmentActivation', () => {
	const now = new Date('2026-08-05T12:00:00.000Z');
	const base = {
		requested: true,
		source: 'manual',
		status: 'reserved',
		startsAt: '2026-08-20T15:00:00.000Z',
		token: 'private-token',
		now
	};

	it('se muestra sólo en el regreso inmediato de un alta interna activa', () => {
		expect(shouldOfferCreatedAppointmentActivation(base)).toBe(true);
		expect(shouldOfferCreatedAppointmentActivation({ ...base, requested: false })).toBe(false);
		expect(shouldOfferCreatedAppointmentActivation({ ...base, source: 'public_booking' })).toBe(false);
		expect(shouldOfferCreatedAppointmentActivation({ ...base, status: 'cancelled' })).toBe(false);
		expect(
			shouldOfferCreatedAppointmentActivation({ ...base, startsAt: '2026-08-05T11:59:59.000Z' })
		).toBe(false);
		expect(shouldOfferCreatedAppointmentActivation({ ...base, token: null })).toBe(false);
	});
});

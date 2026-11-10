import { describe, expect, it } from 'vitest';
import { normalizeSlug, publicBookingPath } from './booking-link';

describe('dirección de reserva', () => {
	it('da la misma dirección que la base para un nombre', () => {
		// Same vectors as supabase/tests/business_booking_links.sql, check 1.
		const vectors: [string, string][] = [
			['Consultorio Ramírez', 'consultorio-ramirez'],
			['  Dra. Natalia   Frutos  ', 'dra-natalia-frutos'],
			['Ñandú & Peña', 'nandu-pena'],
			['ODONTOLOGÍA INTEGRAL', 'odontologia-integral'],
			['Clínica Dental 24/7', 'clinica-dental-24-7'],
			["D'Angelo Sonrisas", 'd-angelo-sonrisas'],
			['Øresund Smile', 'resund-smile'],
			['😀 Sonrisas', 'sonrisas'],
			['Caf´e', 'caf-e'],
			['---', ''],
			['', ''],
			['a'.repeat(79) + ' b', 'a'.repeat(79)]
		];
		expect(vectors.map(([name]) => normalizeSlug(name))).toEqual(vectors.map(([, slug]) => slug));
	});

	it('enlaza la dirección del consultorio, o su identificador si la dirección tiene forma de uno', () => {
		const id = '8b900b87-bcda-49b6-ad1a-6ff4e80b86dc';
		expect(publicBookingPath({ id, slug: 'consultorio-ramirez' })).toBe('/reservar/consultorio-ramirez');
		expect(publicBookingPath({ id, slug: id })).toBe('/reservar/' + id);
		expect(publicBookingPath({ id, slug: 'fixture_con espacio' })).toBe('/reservar/fixture_con%20espacio');
	});
});

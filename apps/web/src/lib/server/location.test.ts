import { describe, expect, it } from 'vitest';
import { buildMapsSearchUrl, isValidMapsUrl, resolveMapsUrl } from './location';

describe('buildMapsSearchUrl', () => {
	it('encodea direcciones con tildes, # y &', () => {
		const url = buildMapsSearchUrl('Av. Santa Fe 1234, Piso 3 #B & C, CABA');
		expect(url).toBe(
			'https://www.google.com/maps/search/?api=1&query=Av.%20Santa%20Fe%201234%2C%20Piso%203%20%23B%20%26%20C%2C%20CABA'
		);
	});

	it('recorta espacios alrededor', () => {
		expect(buildMapsSearchUrl('  Córdoba 100  ')).toContain('query=C%C3%B3rdoba%20100');
	});
});

describe('isValidMapsUrl', () => {
	it('acepta maps.app.goo.gl con cualquier path', () => {
		expect(isValidMapsUrl('https://maps.app.goo.gl/AbC123xyz')).toBe(true);
	});

	it('acepta maps.google.com', () => {
		expect(isValidMapsUrl('https://maps.google.com/?q=consultorio')).toBe(true);
	});

	it('acepta google.com solo con path /maps', () => {
		expect(isValidMapsUrl('https://www.google.com/maps/place/Consultorio/@-31.4,-64.1,17z')).toBe(true);
		expect(isValidMapsUrl('https://google.com/maps/search/dentista')).toBe(true);
		expect(isValidMapsUrl('https://www.google.com/search?q=algo')).toBe(false);
	});

	it('rechaza goo.gl y g.co (shorteners no exclusivos de Maps)', () => {
		expect(isValidMapsUrl('https://goo.gl/maps/abc')).toBe(false);
		expect(isValidMapsUrl('https://g.co/kgs/abc')).toBe(false);
	});

	it('rechaza http, otros hosts y basura', () => {
		expect(isValidMapsUrl('http://maps.google.com/?q=x')).toBe(false);
		expect(isValidMapsUrl('https://evil.com/maps')).toBe(false);
		expect(isValidMapsUrl('no es una url')).toBe(false);
		expect(isValidMapsUrl('')).toBe(false);
	});
});

describe('resolveMapsUrl', () => {
	it('prioriza el link manual válido', () => {
		expect(
			resolveMapsUrl({ address: 'Av. Demo 123', maps_url: 'https://maps.app.goo.gl/xyz' })
		).toBe('https://maps.app.goo.gl/xyz');
	});

	it('cae al link generado si el manual es inválido', () => {
		expect(resolveMapsUrl({ address: 'Av. Demo 123', maps_url: 'https://goo.gl/maps/x' })).toBe(
			buildMapsSearchUrl('Av. Demo 123')
		);
	});

	it('cae al link generado si no hay manual', () => {
		expect(resolveMapsUrl({ address: 'Av. Demo 123', maps_url: null })).toBe(
			buildMapsSearchUrl('Av. Demo 123')
		);
	});

	it('devuelve null sin dirección ni link válido', () => {
		expect(resolveMapsUrl({ address: null, maps_url: null })).toBeNull();
		expect(resolveMapsUrl({ address: '   ', maps_url: 'https://goo.gl/x' })).toBeNull();
	});
});

import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, hmacSha256HexMatches } from './hmac';

const SECRET = 'clave-de-prueba';
const MESSAGE = 'id:123;request-id:req-1;ts:1704908010;';

describe('hmacSha256Hex', () => {
	it('coincide con el HMAC-SHA256 hex de node:crypto', () => {
		const expected = crypto.createHmac('sha256', SECRET).update(MESSAGE, 'utf8').digest('hex');
		expect(hmacSha256Hex(SECRET, MESSAGE)).toBe(expected);
	});
});

describe('hmacSha256HexMatches', () => {
	const valid = hmacSha256Hex(SECRET, MESSAGE);

	it('acepta la firma correcta', () => {
		expect(hmacSha256HexMatches(SECRET, MESSAGE, valid)).toBe(true);
	});

	it('normaliza mayúsculas y espacios del valor provisto', () => {
		expect(hmacSha256HexMatches(SECRET, MESSAGE, ` ${valid.toUpperCase()} `)).toBe(true);
	});

	it('rechaza firmas incorrectas de igual longitud', () => {
		const wrong = valid.replace(/^./, valid[0] === 'a' ? 'b' : 'a');
		expect(hmacSha256HexMatches(SECRET, MESSAGE, wrong)).toBe(false);
	});

	it('rechaza longitudes distintas sin lanzar (timingSafeEqual protegido)', () => {
		expect(hmacSha256HexMatches(SECRET, MESSAGE, 'abc')).toBe(false);
		expect(hmacSha256HexMatches(SECRET, MESSAGE, '')).toBe(false);
	});

	it('rechaza cuando cambia el secret o el mensaje', () => {
		expect(hmacSha256HexMatches('otro-secret', MESSAGE, valid)).toBe(false);
		expect(hmacSha256HexMatches(SECRET, `${MESSAGE}x`, valid)).toBe(false);
	});
});

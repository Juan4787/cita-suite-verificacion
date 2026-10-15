import { describe, expect, it } from 'vitest';
import {
	isLikelyPhoneE164,
	normalizeArgentineWhatsAppPhone,
	normalizePhoneE164
} from './phone';

describe('normalizePhoneE164', () => {
	it('normaliza variantes argentinas del mismo móvil', () => {
		expect(normalizePhoneE164('3511234567')).toBe('+5493511234567');
		expect(normalizePhoneE164('+543511234567')).toBe('+5493511234567');
		expect(normalizePhoneE164('+5493511234567')).toBe('+5493511234567');
	});

	it('devuelve null para entradas vacías', () => {
		expect(normalizePhoneE164('')).toBeNull();
		expect(normalizePhoneE164(null)).toBeNull();
	});
});

describe('isLikelyPhoneE164', () => {
	it('acepta teléfonos normalizados con longitud internacional razonable', () => {
		expect(isLikelyPhoneE164('+5493511234567')).toBe(true);
		expect(isLikelyPhoneE164('3511234567')).toBe(true);
	});

	it('rechaza valores demasiado cortos o vacíos', () => {
		expect(isLikelyPhoneE164('123')).toBe(false);
		expect(isLikelyPhoneE164('')).toBe(false);
		expect(isLikelyPhoneE164(null)).toBe(false);
	});
});

describe('normalizeArgentineWhatsAppPhone', () => {
	it('conserva el formato internacional móvil argentino', () => {
		expect(normalizeArgentineWhatsAppPhone('+54 9 351 123-4567')).toBe('+5493511234567');
		expect(normalizeArgentineWhatsAppPhone('5493511234567')).toBe('+5493511234567');
		expect(normalizeArgentineWhatsAppPhone('0054 9 351 1234567')).toBe('+5493511234567');
	});

	it('agrega 9 a números argentinos de diez dígitos o guardados como +54', () => {
		expect(normalizeArgentineWhatsAppPhone('3511234567')).toBe('+5493511234567');
		expect(normalizeArgentineWhatsAppPhone('0351 1234567')).toBe('+5493511234567');
		expect(normalizeArgentineWhatsAppPhone('+54 351 1234567')).toBe('+5493511234567');
	});

	it('elimina el 15 local con códigos de área de dos, tres o cuatro dígitos', () => {
		expect(normalizeArgentineWhatsAppPhone('011 15 1234-5678')).toBe('+5491112345678');
		expect(normalizeArgentineWhatsAppPhone('0351 15 123-4567')).toBe('+5493511234567');
		expect(normalizeArgentineWhatsAppPhone('03489 15 123456')).toBe('+5493489123456');
	});

	it('recupera formatos locales que el normalizador legado guardó con un + inválido', () => {
		expect(normalizeArgentineWhatsAppPhone('+0351151234567')).toBe('+5493511234567');
		expect(normalizeArgentineWhatsAppPhone('+351151234567')).toBe('+5493511234567');
	});

	it('rechaza números incompletos, extranjeros o estructuralmente ambiguos', () => {
		expect(normalizeArgentineWhatsAppPhone('15 1234567')).toBeNull();
		expect(normalizeArgentineWhatsAppPhone('+598 99 123 456')).toBeNull();
		expect(normalizeArgentineWhatsAppPhone('123')).toBeNull();
		expect(normalizeArgentineWhatsAppPhone('')).toBeNull();
		expect(normalizeArgentineWhatsAppPhone(null)).toBeNull();
	});
});

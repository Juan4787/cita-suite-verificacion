import { describe, expect, it } from 'vitest';
import {
	classifyCommunicationPhone,
	normalizeArgentineWhatsAppPhone,
	resolveCommunicationPhoneDecision
} from './communication-phone';

describe('communication phone', () => {
	it('normalizes complete Argentine mobile numbers without guessing', () => {
		expect(normalizeArgentineWhatsAppPhone('+54 9 351 123-4567')).toBe('+5493511234567');
		expect(normalizeArgentineWhatsAppPhone('0351 15 123-4567')).toBe('+5493511234567');
		expect(normalizeArgentineWhatsAppPhone('011 15 1234-5678')).toBe('+5491112345678');
	});

	it('distinguishes a missing value from a present but unusable one', () => {
		expect(classifyCommunicationPhone('')).toEqual({ status: 'missing', normalized: null });
		expect(classifyCommunicationPhone('123')).toEqual({ status: 'invalid', normalized: null });
		expect(classifyCommunicationPhone('+598 99 123 456')).toEqual({
			status: 'invalid',
			normalized: null
		});
		expect(classifyCommunicationPhone('351 123 4567')).toEqual({
			status: 'valid',
			normalized: '+5493511234567'
		});
	});

	it('only accepts an override that matches the current problem', () => {
		expect(resolveCommunicationPhoneDecision('', 'invalid')).toMatchObject({
			status: 'missing',
			acknowledged: false,
			warning: 'missing'
		});
		expect(resolveCommunicationPhoneDecision('', 'missing')).toMatchObject({
			status: 'missing',
			acknowledged: true,
			warning: null
		});
		expect(resolveCommunicationPhoneDecision('3511234567', 'missing')).toMatchObject({
			status: 'valid',
			acknowledged: false,
			warning: null
		});
	});
});

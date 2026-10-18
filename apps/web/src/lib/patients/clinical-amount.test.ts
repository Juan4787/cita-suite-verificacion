import { describe, expect, it } from 'vitest';
import {
	clinicalAmountForEdit,
	clinicalAmountFromDisplay,
	readClinicalAmount
} from './clinical-amount';
describe('historical clinical amount preservation', () => {
	it('preserves actual stored fractions and zero through editor initialization', () => {
		for (const amount of [125.5, 15000.5, 0.001, 0, -125.5, 18000]) {
			const state = clinicalAmountForEdit(amount);
			expect(readClinicalAmount(state.raw, true)).toEqual({ valid: true, value: amount });
			expect(clinicalAmountFromDisplay(state.display).raw).toBe(String(amount));
		}
	});
	it('distinguishes legacy thousands formatting from explicitly canonical numeric form values', () => {
		expect(readClinicalAmount('18.500')).toEqual({ valid: true, value: 18500 });
		expect(readClinicalAmount('125.5')).toEqual({ valid: true, value: 125.5 });
		expect(readClinicalAmount('0.001', true)).toEqual({ valid: true, value: 0.001 });
		expect(readClinicalAmount('15.000,50')).toEqual({ valid: true, value: 15000.5 });
	});
	it('keeps a trailing decimal separator usable without inflating the submitted amount', () => {
		expect(clinicalAmountFromDisplay('125,')).toEqual({ valid: true, display: '125,', raw: '125' });
		expect(clinicalAmountFromDisplay('125,5')).toEqual({
			valid: true,
			display: '125,5',
			raw: '125.5'
		});
		expect(clinicalAmountFromDisplay('15.000,50').raw).toBe('15000.5');
	});
	it('rejects ambiguous or nonnumeric input instead of silently stripping punctuation and letters', () => {
		for (const value of ['1..2', 'ARS 125', 'NaN', 'Infinity', '0x10', '1,2,3']) {
			expect(readClinicalAmount(value).valid).toBe(false);
			expect(clinicalAmountFromDisplay(value).valid).toBe(false);
		}
		expect(readClinicalAmount('')).toEqual({ valid: true, value: null });
	});
});

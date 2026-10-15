import { describe, expect, it } from 'vitest';
import { formatMoneyInteger, formatPriceLabel, moneyDigits, parseMoneyInteger } from './money-input';

describe('money-input', () => {
	it('formatea miles mientras conserva solo digitos para persistir', () => {
		expect(moneyDigits('350000')).toBe('350000');
		expect(formatMoneyInteger('350000')).toBe('350.000');
		expect(parseMoneyInteger('350.000')).toBe(350000);
	});

	it('tolera pegado con simbolos, espacios y separadores', () => {
		expect(formatMoneyInteger('$ 1.250.000')).toBe('1.250.000');
		expect(formatMoneyInteger('ARS 1250000')).toBe('1.250.000');
		expect(formatPriceLabel('350000')).toBe('$ 350.000');
	});

	it('evita ceros a la izquierda sin romper el cero simple ni el vacio', () => {
		expect(formatMoneyInteger('000350000')).toBe('350.000');
		expect(formatMoneyInteger('0')).toBe('0');
		expect(formatMoneyInteger('')).toBe('');
		expect(parseMoneyInteger('')).toBeNull();
	});
});

import { describe, expect, it } from 'vitest';
import vectors from '../../../../../packages/shared/src/price-contract-vectors.json';
import { previewMonthlyPrices, type PriceAdjustment } from './pricing';

// The SQL suite consumes this exact JSON file too; expected amounts are fixed
// contract examples, never generated with either implementation under test.
describe('price contract vectors shared with real PostgreSQL', () => {
	for (const vector of vectors) {
		it(vector.name, () => {
			const adjustments: PriceAdjustment[] = vector.adjustments.map(row => {
				if (row.kind !== 'default' && row.kind !== 'override') throw new Error('Invalid shared price fixture.');
				return { month: row.month, kind: row.kind, percentage: row.percentage };
			});
			const calculate = () => previewMonthlyPrices(vector.base, vector.monthly, vector.rounding,
				vector.baseMonth, vector.firstMonth, adjustments, vector.count, vector.startMonth);
			if (vector.error) expect(calculate).toThrow(vector.error);
			else expect(calculate()).toEqual(vector.expected);
		});
	}
	it('allows up to 120 quoted results including the last month, never 121', () => {
		const rows = previewMonthlyPrices('7', '0', '1', '2026-01', '2026-02', [], 120, '2066-02');
		expect(rows).toHaveLength(120);
		expect(rows.at(-1)).toEqual({ month: '2076-01', amount: 7 });
		expect(() => previewMonthlyPrices('7', '0', '1', '2026-01', '2026-02', [], 121)).toThrow('PRICE_CONFIGURATION_INVALID');
	});
});

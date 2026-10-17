import { describe, it, expect } from 'vitest';
import { parseStorageMegabytes, storageMegabytesInput } from './clinical-storage-units';

describe('exact storage capacity input', () => {
	it('round-trips byte-exact decimal MB including the safe integer boundary', () => {
		for (const bytes of [1, 200000, 3500000, 100000000, 700000000, Number.MAX_SAFE_INTEGER])
			expect(parseStorageMegabytes(storageMegabytesInput(bytes))).toBe(bytes);
	});
	it('rejects zero, exponent notation, grouping, excessive precision and unsafe integers', () => {
		for (const input of ['', '0', '0,000000', '-1', '1.000', '1e3', '1,0000001', '9007199254,740992', '1,2,3'])
			expect(parseStorageMegabytes(input)).toBeNull();
	});
	it('does not interpret an Argentine decimal as a thousands separator', () => {
		expect(parseStorageMegabytes('100,5')).toBe(100500000);
		expect(parseStorageMegabytes(' 100 ')).toBe(100000000);
	});
});

import { describe, expect, it } from 'vitest';
import { isUuid } from '@cita-suite/shared/uuid';

describe('isUuid', () => {
	it('accepts the canonical form of any version', () => {
		for (const value of [
			'7f9c2ba4-e88f-4c3a-9a3e-2b6c1f0d9e11',
			'7F9C2BA4-E88F-4C3A-9A3E-2B6C1F0D9E11',
			'0192f1c4-7b2e-7d3a-8c1f-5a6b7c8d9e0f'
		])
			expect(isUuid(value)).toBe(true);
	});

	it('rejects anything that is not exactly one identifier', () => {
		for (const value of [
			'',
			' 7f9c2ba4-e88f-4c3a-9a3e-2b6c1f0d9e11',
			'7f9c2ba4e88f4c3a9a3e2b6c1f0d9e11',
			'7f9c2ba4-e88f-4c3a-9a3e-2b6c1f0d9e11,id.not.is.null',
			'consultorio-perez',
			null,
			42
		])
			expect(isUuid(value)).toBe(false);
	});
});

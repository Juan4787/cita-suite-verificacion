import { describe, expect, it, vi } from 'vitest';
import { logServerFailure } from './logging';

describe('bounded server failure diagnostics', () => {
	it('retains only SQL state/status and excludes clinical data, tokens, URLs and arbitrary metadata', () => {
		const output = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			logServerFailure('patient.read.failed', {
				code: '53300',
				status: 503,
				message: 'private clinical history',
				details: 'https://storage.test/signed?token=private',
				hint: 'secret',
				name: 'patient name',
				nested: { authorization: 'private' }
			});
			expect(output.mock.calls).toEqual([
				['patient.read.failed', { sqlState: '53300', httpStatus: 503 }]
			]);
			logServerFailure('patient.read.failed', { code: 'a clinical value', status: 'private' });
			expect(output.mock.calls[1]).toEqual(['patient.read.failed', {}]);
		} finally {
			output.mockRestore();
		}
	});
	it('does not let an invalid diagnostic alter the user operation', () => {
		const output = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			expect(() =>
				logServerFailure('patient.read.failed', {
					get code() {
						throw new Error('private');
					}
				})
			).not.toThrow();
			expect(output.mock.calls).toEqual([['patient.read.failed', {}]]);
		} finally {
			output.mockRestore();
		}
	});
});

import { describe, expect, it } from 'vitest';
import { assertExpectedFollowUpVersion, FollowUpError, isStaleFollowUpUpdatedAt } from './follow-ups';

describe('isStaleFollowUpUpdatedAt & assertExpectedFollowUpVersion', () => {
	it('reconoce como frescas versiones con idéntico string', () => {
		const ts = '2026-09-04T06:30:00.000Z';
		expect(isStaleFollowUpUpdatedAt(ts, ts)).toBe(false);
		expect(() => assertExpectedFollowUpVersion(ts, { updated_at: ts })).not.toThrow();
	});

	it('tolera diferencias de formato ISO entre cliente (3 decimales Z) y Postgres (6 decimales +00:00)', () => {
		const clientIso = '2026-09-04T06:30:15.123Z';
		const postgresIso = '2026-09-04T06:30:15.123456+00:00';
		expect(isStaleFollowUpUpdatedAt(clientIso, postgresIso)).toBe(false);
		expect(() => assertExpectedFollowUpVersion(clientIso, { updated_at: postgresIso })).not.toThrow();
	});

	it('tolera jitter de hasta 1000ms en el timestamp', () => {
		const clientIso = '2026-09-04T06:30:15.000Z';
		const postgresIso = '2026-09-04T06:30:15.850Z';
		expect(isStaleFollowUpUpdatedAt(clientIso, postgresIso, 1000)).toBe(false);
		expect(() => assertExpectedFollowUpVersion(clientIso, { updated_at: postgresIso })).not.toThrow();
	});

	it('detecta conflicto real cuando la versión cambió significativamente', () => {
		const clientIso = '2026-09-04T06:30:00.000Z';
		const postgresIso = '2026-09-04T06:30:05.000Z';
		expect(isStaleFollowUpUpdatedAt(clientIso, postgresIso)).toBe(true);
		expect(() => assertExpectedFollowUpVersion(clientIso, { updated_at: postgresIso })).toThrow(FollowUpError);
		expect(() => assertExpectedFollowUpVersion(clientIso, { updated_at: postgresIso })).toThrowError(
			expect.objectContaining({ code: 'FOLLOWUP_STATUS_CONFLICT' })
		);
	});

	it('detecta conflicto si expectedUpdatedAt o current es nulo o vacío', () => {
		expect(isStaleFollowUpUpdatedAt(null, '2026-09-04T06:30:00.000Z')).toBe(true);
		expect(isStaleFollowUpUpdatedAt('', '2026-09-04T06:30:00.000Z')).toBe(true);
		expect(isStaleFollowUpUpdatedAt('2026-09-04T06:30:00.000Z', null)).toBe(true);
		expect(() => assertExpectedFollowUpVersion(null, { updated_at: '2026-09-04T06:30:00.000Z' })).toThrow(
			FollowUpError
		);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	PATIENT_CURSOR_SECRET: 'phase-1-cursor-secret',
	RATE_LIMIT_SALT: undefined as string | undefined,
	ODONTO_SUPABASE_SERVICE_ROLE_KEY: undefined as string | undefined
}));

vi.mock('$env/dynamic/private', () => ({ env: envState }));

import { decodePatientListCursor, encodePatientListCursor } from './patient-list-cursor';

const value = {
	businessId: '10000000-0000-4000-8000-000000000001',
	showArchived: false,
	query: 'juan',
	snapshotAt: '2026-08-20T12:00:00.000Z',
	rank: 1,
	activityAt: '2026-08-19T10:30:00+00:00',
	id: '20000000-0000-4000-8000-000000000001'
};

describe('patient list signed cursor', () => {
	beforeEach(() => {
		envState.PATIENT_CURSOR_SECRET = 'phase-1-cursor-secret';
		envState.RATE_LIMIT_SALT = undefined;
		envState.ODONTO_SUPABASE_SERVICE_ROLE_KEY = undefined;
	});

	it('fails closed instead of signing with a public fallback when no server secret exists', () => {
		envState.PATIENT_CURSOR_SECRET = '';
		expect(() => encodePatientListCursor(value)).toThrow('PATIENT_CURSOR_SECRET_MISSING');
	});

	it('round-trips only in the exact business, tab and normalized query scope', () => {
		const cursor = encodePatientListCursor(value);
		const [encoded] = cursor.split('.');
		const visiblePayload = Buffer.from(encoded, 'base64url').toString('utf8');
		expect(visiblePayload).not.toContain(value.businessId);
		expect(visiblePayload).not.toContain(value.query);

		expect(
			decodePatientListCursor(cursor, {
				businessId: value.businessId,
				showArchived: value.showArchived,
				query: value.query
			})
		).toEqual({
			v: 1,
			snapshotAt: value.snapshotAt,
			rank: value.rank,
			activityAt: value.activityAt,
			id: value.id
		});
		expect(
			decodePatientListCursor(cursor, {
				businessId: value.businessId,
				showArchived: true,
				query: value.query
			})
		).toBeNull();
		expect(
			decodePatientListCursor(cursor, {
				businessId: value.businessId,
				showArchived: false,
				query: 'otra búsqueda'
			})
		).toBeNull();
	});

	it('rejects tampered data and signatures', () => {
		const cursor = encodePatientListCursor(value);
		const [encoded, signature] = cursor.split('.');
		const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
		const tampered = Buffer.from(
			JSON.stringify({ ...parsed, rank: parsed.rank + 1 })
		).toString('base64url');

		expect(
			decodePatientListCursor(`${tampered}.${signature}`, {
				businessId: value.businessId,
				showArchived: false,
				query: value.query
			})
		).toBeNull();
		expect(
			decodePatientListCursor(`${encoded}.${signature.slice(0, -1)}x`, {
				businessId: value.businessId,
				showArchived: false,
				query: value.query
			})
		).toBeNull();
	});

	it('rejects malformed timestamps, UUIDs and ranks even with a valid signature', () => {
		for (const malformed of [
			{ ...value, snapshotAt: 'August 20, 2026' },
			{ ...value, activityAt: '2026-08-20T12:00:00Z,or(true)' },
			{ ...value, id: '------------------------------------' },
			{ ...value, rank: -1 }
		]) {
			const cursor = encodePatientListCursor(malformed);
			expect(
				decodePatientListCursor(cursor, {
					businessId: value.businessId,
					showArchived: false,
					query: value.query
				})
			).toBeNull();
		}
	});
});

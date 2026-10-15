import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('legacy hold expirer migration', () => {
	it('revoca el RPC global heredado para todos los roles públicos', () => {
		const migration = readFileSync(
			new URL('../../../../../supabase/migrations/20260831061000_revoke_legacy_hold_expirer.sql', import.meta.url),
			'utf8'
		);

		expect(migration).toContain(
			'revoke all on function public.expire_public_booking_holds() from public, anon, authenticated'
		);
	});
});

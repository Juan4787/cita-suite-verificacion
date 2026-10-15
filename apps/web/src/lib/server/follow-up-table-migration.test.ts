import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL('../../../../../supabase/migrations/20260831065000_lock_follow_up_table_to_backend.sql', import.meta.url),
	'utf8'
);

describe('acceso directo a seguimientos', () => {
	it('deja las mutaciones y lecturas en el backend con scope de rol', () => {
		expect(migration).toContain('drop policy if exists follow_ups_select on public.follow_ups');
		expect(migration).toContain('drop policy if exists follow_ups_write on public.follow_ups');
		expect(migration).toContain('revoke all on table public.follow_ups from public, anon, authenticated');
		expect(migration).toContain('grant select, insert, update, delete on table public.follow_ups to service_role');
	});
});

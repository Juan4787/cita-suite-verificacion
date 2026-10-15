import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL('../../../../../supabase/migrations/20260831063000_remove_legacy_owner_policies.sql', import.meta.url),
	'utf8'
);

describe('políticas históricas de owner_id', () => {
	it('elimina las políticas que no exigían pertenencia al consultorio', () => {
		for (const policy of [
			'patients_delete',
			'patients_insert',
			'patients_select',
			'patients_update',
			'entries_delete',
			'entries_insert',
			'entries_select',
			'entries_update'
		]) {
			expect(migration).toContain(`drop policy if exists ${policy} on public.`);
		}
	});
});

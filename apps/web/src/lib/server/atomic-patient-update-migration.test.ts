import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL('../../../../../supabase/migrations/20260831064000_atomic_patient_profile_update.sql', import.meta.url),
	'utf8'
);

describe('actualización atómica de paciente y perfil clínico', () => {
	it('usa una función transaccional con bloqueo optimista y no queda expuesta a clientes', () => {
		expect(migration).toContain('create or replace function public.update_patient_with_clinical_profile_safely(');
		expect(migration).toContain('security definer');
		expect(migration).toContain('set search_path = public, extensions, pg_catalog');
		expect(migration).toContain('for update;');
		expect(migration).toContain("raise exception 'PATIENT_UPDATE_CONFLICT'");
		expect(migration).toContain('revoke all on function public.update_patient_with_clinical_profile_safely(');
		expect(migration).toContain('from public, anon, authenticated');
		expect(migration).toContain('grant execute on function public.update_patient_with_clinical_profile_safely(');
		expect(migration).toContain('to service_role;');
	});
});

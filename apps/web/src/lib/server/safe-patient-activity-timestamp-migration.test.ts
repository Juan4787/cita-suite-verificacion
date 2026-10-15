import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL('../../../../../supabase/migrations/20260904031500_safe_patient_activity_timestamp.sql', import.meta.url),
	'utf8'
);

describe('migración de aislamiento de timestamps de actividad en pacientes', () => {
	it('protege patients.updated_at de mutaciones de actividad interna', () => {
		expect(migration).toContain('create or replace function public.set_patients_updated_at()');
		expect(migration).toContain('drop trigger if exists set_patients_updated_at on public.patients;');
		expect(migration).toContain('create trigger set_patients_updated_at');
		expect(migration).toContain('before update on public.patients');
		expect(migration).toContain('for each row execute function public.set_patients_updated_at();');
		expect(migration).toContain('new.updated_at is distinct from old.updated_at');
		expect(migration).toContain('revoke all on function public.set_patients_updated_at() from public, anon, authenticated;');
	});
});

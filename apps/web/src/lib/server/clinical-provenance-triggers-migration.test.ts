import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL('../../../../../supabase/migrations/20260831068000_restore_clinical_provenance_triggers.sql', import.meta.url),
	'utf8'
);

describe('triggers de procedencia clínica', () => {
	it('reconstruye vínculos, actor y timestamps desde una base limpia', () => {
		expect(migration).toContain('create or replace function public.create_or_restore_professional_patient_link(');
		expect(migration).toContain('create or replace function public.link_patient_to_professional_from_appointment()');
		expect(migration).toContain('create or replace function public.link_patient_to_professional_from_clinical_entry()');
		expect(migration).toContain('create or replace function public.set_clinical_entry_actor_fields()');
		expect(migration).toContain('create or replace function public.set_updated_at()');
		expect(migration).toContain('trg_appointments_professional_patient_link');
		expect(migration).toContain('trg_clinical_entries_professional_patient_link');
		expect(migration).toContain('trg_clinical_entries_actor_fields');
		expect(migration).toContain('revoke all on function %s from public, anon, authenticated');
	});
});

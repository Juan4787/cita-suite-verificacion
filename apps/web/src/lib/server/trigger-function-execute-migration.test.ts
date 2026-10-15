import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL('../../../../../supabase/migrations/20260831062000_restrict_trigger_function_execute.sql', import.meta.url),
	'utf8'
);

describe('privilegios de funciones de trigger', () => {
	it('retira la ejecución pública y conserva sólo los roles de aplicación/backend', () => {
		expect(migration).toContain('foreach function_signature in array array[');
		expect(migration).toContain("revoke all on function %s from public, anon, authenticated");
		expect(migration).toContain("grant execute on function %s to authenticated, service_role");
		for (const signature of [
			'enforce_appointment_role_update()',
			'link_patient_to_professional_from_appointment()',
			'link_patient_to_professional_from_clinical_entry()',
			'prepare_appointment_professional()',
			'reset_push_reminders_on_reschedule()',
			'set_appointment_snapshots_and_blocking_range()',
			'set_clinical_entry_actor_fields()',
			'sync_appointment_professionals()'
		]) {
			expect(migration).toContain(`'public.${signature}'`);
		}
		expect(migration).toContain("'public.user_is_professional_for(uuid)'");
	});
});

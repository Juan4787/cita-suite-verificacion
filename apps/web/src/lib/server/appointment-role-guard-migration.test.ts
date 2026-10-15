import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL('../../../../../supabase/migrations/20260831067000_restore_appointment_role_guard.sql', import.meta.url),
	'utf8'
);

describe('defensa de rol en mutaciones directas de turnos', () => {
	it('reconstruye el trigger y no deja su ejecución como API pública', () => {
		expect(migration).toContain('create or replace function public.enforce_appointment_role_update()');
		expect(migration).toContain('drop trigger if exists trg_appointments_role_update on public.appointments');
		expect(migration).toContain('before update');
		expect(migration).toContain('revoke all on function public.enforce_appointment_role_update() from public, anon, authenticated');
		expect(migration).toContain('grant execute on function public.enforce_appointment_role_update() to service_role');
		expect(migration).toContain("raise exception 'APPOINTMENT_ACCESS_DENIED'");
	});
});

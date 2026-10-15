import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL(
		'../../../../../supabase/migrations/20260824010000_push_devices_expand.sql',
		import.meta.url
	),
	'utf8'
);
const triggerMigration = readFileSync(
	new URL(
		'../../../../../supabase/migrations/20260702151000_reset_push_reminders_on_reschedule.sql',
		import.meta.url
	),
	'utf8'
);

describe('reseteo transaccional de recordatorios al reprogramar', () => {
	it('se dispara únicamente cuando cambia starts_at y limpia las dos ventanas', () => {
		expect(triggerMigration).toContain('after update of starts_at on appointments');
		expect(triggerMigration).toContain('when (new.starts_at is distinct from old.starts_at)');
		expect(migration).toContain('push_24h_claimed_at = null');
		expect(migration).toContain('push_24h_sent_at = null');
		expect(migration).toContain('push_2h_claimed_at = null');
		expect(migration).toContain('push_2h_sent_at = null');
	});

	it('resetea sólo vínculos activos sin alterar permiso, salud ni verificación del dispositivo', () => {
		const functionBody = migration.slice(
			migration.indexOf('create or replace function public.reset_push_reminders_on_reschedule'),
			migration.indexOf('create or replace function private.validate_push_delivery_attempt_identity')
		);
		expect(functionBody).toContain('and subscription.detached_at is null');
		expect(functionBody).not.toContain('push_devices');
		expect(functionBody).not.toContain('provider_gone_at');
		expect(functionBody).not.toContain('last_test_confirmed_at');
	});
});

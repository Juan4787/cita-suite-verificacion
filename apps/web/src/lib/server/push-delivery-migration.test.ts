import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL(
		'../../../../../supabase/migrations/20260824010000_push_devices_expand.sql',
		import.meta.url
	),
	'utf8'
);

describe('contrato de entrega push independiente de la respuesta', () => {
	it('reclama recordatorios vigentes aunque la prueba todavía no fue confirmada', () => {
		const claimFunction = migration.slice(
			migration.indexOf('create or replace function public.claim_due_push_reminders'),
			migration.indexOf('revoke all on function public.claim_due_push_reminders')
		);

		expect(claimFunction).not.toContain('verified_at');
		expect(claimFunction.match(/subscription\.detached_at is null/g)).toHaveLength(2);
		expect(claimFunction.match(/device\.provider_gone_at is null/g)).toHaveLength(2);
		expect(claimFunction).toContain(
			"appointment.status in ('reserved', 'confirmed', 'reschedule_requested')"
		);
		expect(claimFunction).toContain(
			"appointment.starts_at <= claim_now + interval '24 hours'"
		);
		expect(claimFunction).toContain(
			"appointment.starts_at <= claim_now + interval '2 hours'"
		);
		expect(claimFunction.match(/for update of subscription skip locked/g)).toHaveLength(2);
	});

	it('mantiene la RPC restringida al servicio interno', () => {
		expect(migration).toContain(
			'revoke all on function public.claim_due_push_reminders(timestamptz, integer)'
		);
		expect(migration).toContain('from public, anon, authenticated');
		expect(migration).toContain('to service_role');
	});
});

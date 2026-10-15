import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL('../../../../../supabase/migrations/20260822020000_appointment_phone_decision.sql', import.meta.url),
	'utf8'
);
const consistencyMigration = readFileSync(
	new URL(
		'../../../../../supabase/migrations/20260822021000_appointment_phone_decision_consistency.sql',
		import.meta.url
	),
	'utf8'
);

describe('appointment phone decision migration', () => {
	it('persists a constrained phone status and an explicit acknowledgement on the appointment', () => {
		expect(migration).toContain('phone_communication_status_at_booking');
		expect(migration).toContain("('unknown', 'valid', 'missing', 'invalid')");
		expect(migration).toContain('phone_warning_acknowledged_at');
	});

	it('keeps joint creation and the phone decision in one database transaction', () => {
		expect(migration).toContain('create_joint_appointment_with_phone_decision');
		expect(migration).toContain('create_joint_appointment_with_source');
		expect(migration).toContain("('unknown', 'valid', 'missing', 'invalid')");
		expect(migration).toContain('PHONE_WARNING_ACKNOWLEDGEMENT_REQUIRED');
		expect(migration).toContain('phone_warning_acknowledged_at = case');
		expect(migration).toContain('phone_warning_acknowledged');
	});

	it('does not expose the creation function to browser roles', () => {
		expect(migration).toContain('from public, anon, authenticated');
		expect(migration).toContain('to service_role');
	});

	it('rejects partial or contradictory decisions at the database boundary', () => {
		expect(consistencyMigration).toContain(
			'appointments_phone_warning_decision_consistency_check'
		);
		expect(consistencyMigration).toContain(
			"phone_communication_status_at_booking in ('missing', 'invalid')"
		);
		expect(consistencyMigration).toContain('phone_warning_acknowledged_at is not null');
		expect(consistencyMigration).toContain(
			"phone_communication_status_at_booking in ('unknown', 'valid')"
		);
		expect(consistencyMigration).toContain('phone_warning_acknowledged_at is null');
	});
});

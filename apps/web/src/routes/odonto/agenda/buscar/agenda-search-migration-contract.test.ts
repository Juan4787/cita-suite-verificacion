import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
	new URL(
		'../../../../../../../supabase/migrations/20260823130000_fast_agenda_active_search.sql',
		import.meta.url
	),
	'utf8'
);
const historyMigration = readFileSync(
	new URL(
		'../../../../../../../supabase/migrations/20260827170000_agenda_search_active_history.sql',
		import.meta.url
	),
	'utf8'
);
const expiredWindowMigration = readFileSync(
	new URL(
		'../../../../../../../supabase/migrations/20260827173000_agenda_search_expired_window.sql',
		import.meta.url
	),
	'utf8'
);
const threeMonthExpiredWindowMigration = readFileSync(
	new URL(
		'../../../../../../../supabase/migrations/20260827190000_agenda_search_expired_window_three_months.sql',
		import.meta.url
	),
	'utf8'
);

describe('fast agenda search migration contract', () => {
	it('runs the active appointment lookup as one bounded and indexed database operation', () => {
		expect(migration).toContain('appointments_business_active_starts_patient_idx');
		expect(migration).toContain('function public.search_upcoming_active_appointments(');
		expect(migration).toContain("appointment.status in ('reserved', 'confirmed', 'reschedule_requested')");
		expect(migration).toContain('appointment.starts_at >= statement_timestamp()');
		expect(migration).toContain('limit v_limit');
	});

	it('preserves accent-insensitive name prefixes, word prefixes and phone matching', () => {
		expect(migration).toContain('public.normalize_patient_search_text');
		expect(migration).toContain("position(' ' in v_query) = 0");
		expect(migration).toContain('patient.search_name_normalized like');
		expect(migration).toContain('length(v_digits) >= 2');
		expect(migration).toContain("patient.search_phone_digits like '%' || v_digits || '%'");
	});

	it('checks tenant access, excludes professional accounts and grants only authenticated execution', () => {
		expect(migration).toContain('public.user_has_business_access(p_business_id)');
		expect(migration).toContain("not in ('owner', 'admin', 'reception', 'readonly')");
		expect(migration).toContain('public.business_allows_operation(p_business_id)');
		expect(migration).toContain(
			'grant execute on function public.search_upcoming_active_appointments(uuid, text, integer)'
		);
	});

	it('keeps active past appointments searchable and orders future results first', () => {
		expect(historyMigration).toContain('create or replace function public.search_upcoming_active_appointments(');
		expect(historyMigration).toContain("appointment.status in ('reserved', 'confirmed', 'reschedule_requested')");
		expect(historyMigration).toContain('v_now timestamptz := statement_timestamp()');
		expect(historyMigration).toContain('(appointment.starts_at < v_now) asc');
		expect(historyMigration).not.toContain('and appointment.starts_at >= statement_timestamp()');
	});

	it('introduced the expired-result window without changing persisted status', () => {
		expect(expiredWindowMigration).toContain(
			"appointment.starts_at >= v_now - interval '6 months'"
		);
		expect(expiredWindowMigration).toContain(
			"appointment.status in ('reserved', 'confirmed', 'reschedule_requested')"
		);
		expect(expiredWindowMigration).toContain('starts_at');
		expect(expiredWindowMigration).toContain('El estado persistido no se modifica');
	});

	it('reduces the current expired-result window to three calendar months', () => {
		expect(threeMonthExpiredWindowMigration).toContain(
			"appointment.starts_at >= v_now - interval '3 months'"
		);
		expect(threeMonthExpiredWindowMigration).not.toContain("interval '6 months'");
		expect(threeMonthExpiredWindowMigration).toContain(
			"appointment.status in ('reserved', 'confirmed', 'reschedule_requested')"
		);
		expect(threeMonthExpiredWindowMigration).toContain(
			'El estado persistido no se modifica'
		);
	});
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
	new URL(
		'../../../../../../../../supabase/migrations/20260823140000_preload_agenda_active_search.sql',
		import.meta.url
	),
	'utf8'
);

describe('agenda search preload migration contract', () => {
	it('returns only a compact bounded set of upcoming active appointments', () => {
		expect(migration).toContain('function public.list_upcoming_active_appointments_snapshot(');
		expect(migration).toContain('least(greatest(coalesce(p_limit, 400), 1), 400)');
		expect(migration).toContain("appointment.status in ('reserved', 'confirmed', 'reschedule_requested')");
		expect(migration).toContain('appointment.starts_at >= statement_timestamp()');
		expect(migration).toContain('limit v_limit');
		expect(migration).not.toContain("'internal_note', appointment.internal_note");
	});

	it('keeps the same tenant, role and operation checks as authoritative search', () => {
		expect(migration).toContain('public.user_has_business_access(p_business_id)');
		expect(migration).toContain("not in ('owner', 'admin', 'reception', 'readonly')");
		expect(migration).toContain('public.business_allows_operation(p_business_id)');
		expect(migration).toContain(
			'grant execute on function public.list_upcoming_active_appointments_snapshot(uuid, integer)'
		);
	});
});

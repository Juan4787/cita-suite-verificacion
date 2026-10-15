import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	resolve(process.cwd(), '../../supabase/migrations/20260726030000_patient_list_revision_cache.sql'),
	'utf8'
);

describe('patient list revision migration contract', () => {
	it('increments a monotonic revision and covers every table that changes list visibility', () => {
		expect(migration).toContain('patients_revision = revisions.patients_revision + 1');
		expect(migration).toContain('after insert or update or delete on public.patients');
		expect(migration).toContain(
			'after insert or update or delete on public.professional_patient_links'
		);
		expect(migration).toContain('after insert or update or delete on public.professional_users');
		expect(migration).toContain('after insert or update or delete on public.business_users');
		expect(migration).toContain(
			'after insert or update or delete on public.account_assistance_grants'
		);
		expect(migration).toContain(
			'after insert or update or delete on public.business_subscriptions'
		);
		expect(migration).toContain('array[old.business_id, new.business_id]');
		expect(migration).toContain(
			'select 1 from public.businesses where id = v_business_id'
		);
	});

	it('exposes one compact authenticated RPC and checks business access inside the database', () => {
		expect(migration).toContain('function public.get_patient_data_revision(p_business_id uuid)');
		expect(migration).toContain('public.user_has_business_access(p_business_id)');
		expect(migration).toContain('public.user_business_role(p_business_id)');
		expect(migration).toContain(
			'grant execute on function public.get_patient_data_revision(uuid) to authenticated'
		);
		expect(migration).toContain(
			'revoke all on function public.get_patient_data_revision(uuid) from public, anon'
		);
	});

	it('authorizes a private opaque topic without granting patient-table access', () => {
		// Supabase administra esta tabla y ya habilita RLS; la migración solo agrega su política.
		expect(migration).not.toContain('alter table realtime.messages enable row level security');
		expect(migration).toContain("'business-data:' || revisions.realtime_topic_token::text");
		expect(migration).toContain('for select\nto anon, authenticated');
		expect(migration).toContain("realtime.messages.extension = 'broadcast'");
		expect(migration).toContain(
			'revoke all on table public.business_data_revisions from public, anon, authenticated'
		);
		expect(migration).not.toContain(
			'grant select on table public.business_data_revisions to anon'
		);
	});

	it('broadcasts only the resource name and revision, never patient data', () => {
		const payload = migration.match(/jsonb_build_object\(([^)]*)\)/s)?.[1] ?? '';
		expect(payload).toContain("'resource', 'patients'");
		expect(payload).toContain("'revision', v_revision::text");
		expect(payload).not.toMatch(/patient_id|full_name|dni|phone|clinical/i);
		expect(migration).toContain('when others then');
	});
});

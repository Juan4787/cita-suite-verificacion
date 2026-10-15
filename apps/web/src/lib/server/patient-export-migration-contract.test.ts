import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	resolve(process.cwd(), '../../supabase/migrations/20260827220000_patient_data_exports.sql'),
	'utf8'
);

describe('patient export migration contract', () => {
	it('adds no trigger or revision work to normal clinical writes', () => {
		expect(migration).not.toMatch(/\bcreate\s+trigger\b/i);
		expect(migration).not.toContain('business_export_revisions');
		expect(migration).toContain('private.patient_export_snapshot');
		expect(migration).toContain("string_agg(version.version_token, E'\\n' order by version.version_token)");
		expect(migration).toContain("digest(fingerprint_input.value, 'sha256')");
	});

	it('fingerprints every source whose values or resolved names are exported', () => {
		for (const source of [
			'public.businesses',
			'public.patients',
			'public.patient_clinical_profiles',
			'public.clinical_entries',
			'public.clinical_entry_costs',
			'public.appointments',
			'public.appointment_professionals',
			'public.follow_ups',
			'public.professionals'
		]) {
			expect(migration).toContain(source);
		}
		expect(migration.match(/xmin::text/g)?.length).toBeGreaterThanOrEqual(9);
		expect(migration).toContain('v_current_fingerprint is distinct from v_session.dataset_fingerprint');
	});

	it('requires a direct accepted manager and never uses assistance as authorization', () => {
		const authorization = migration.split(
			'create or replace function private.user_can_export_patient_data'
		)[1]?.split('revoke all on function private.user_can_export_patient_data')[0];

		expect(authorization).toContain('public.business_users');
		expect(authorization).toContain("membership.role in ('owner', 'admin')");
		expect(authorization).toContain("coalesce(membership.status, 'active') = 'active'");
		expect(authorization).toContain('membership.accepted_at is not null');
		expect(authorization).toContain('membership.disabled_at is null');
		expect(authorization).toContain('business_allows_owner_restricted_read');
		expect(authorization).not.toContain('account_assistance');
	});

	it('keeps the export control plane server-only so the HTTP rate limit cannot be bypassed', () => {
		for (const signature of [
			'public.begin_patient_export(uuid, uuid, text, uuid, uuid)',
			'public.read_patient_export_page(uuid, uuid, text, jsonb, integer)',
			'public.validate_patient_export(uuid, uuid, jsonb)',
			'public.cancel_patient_export(uuid, uuid)'
		]) {
			expect(migration).toContain(`revoke all on function ${signature}`);
			expect(migration).toContain(`grant execute on function ${signature}\n\tto service_role`);
		}
	});

	it('keeps sessions private, bounded and recoverable after abandonment', () => {
		expect(migration).toContain('alter table public.patient_export_sessions enable row level security');
		expect(migration).toContain(
			'revoke all on table public.patient_export_sessions from public, anon, authenticated'
		);
		expect(migration).toContain('patient_export_one_active_global_uq');
		expect(migration).toContain("status in ('requested', 'streaming')");
		expect(migration).toContain("statement_timestamp() + interval '30 minutes'");
		expect(migration).toContain('private.expire_patient_export_sessions');
		expect(migration).toContain('cita-suite-patient-export-maintenance');
	});

	it('paginates only a fixed dataset enum and selects portable fields explicitly', () => {
		const paging = migration.split(
			'create or replace function public.read_patient_export_page'
		)[1]?.split('revoke all on function public.read_patient_export_page')[0] ?? '';

		for (const dataset of [
			'patients',
			'custom_fields',
			'clinical_entries',
			'appointments',
			'appointment_professionals',
			'follow_ups'
		]) {
			expect(paging).toContain(`'${dataset}'`);
		}
		expect(paging).toContain('limit v_limit + 1');
		expect(paging).toContain('v_page_max_bytes constant integer := 1500000');
		expect(paging).not.toContain('jsonb_object_length');
		expect(paging).toContain("'next_cursor', v_next_cursor");
		expect(paging).toContain('entry.created_by_professional_id::text as professional_id');
		expect(paging).toContain('cost.amount');
		expect(paging).toContain('allocation.professional_name_snapshot');
		expect(paging).not.toMatch(
			/confirmation_token|phone_e164|phone_raw|creation_request_key|google_calendar|created_by_user_id|updated_by_user_id|cancelled_by_user_id/
		);
	});

	it('makes requested, validated, failed, expired and cancelled events authoritative', () => {
		for (const action of [
			'patient_export_requested',
			'patient_export_dataset_validated',
			'patient_export_failed',
			'patient_export_expired',
			'patient_export_cancelled'
		]) {
			expect(migration).toContain(`'${action}'`);
		}
		expect(migration).toContain("'expected_counts', v_session.expected_counts");
		expect(migration).not.toContain("'full_name'");
		expect(migration).not.toContain("'dni'");
		expect(migration).not.toContain("'phone'");
	});

	it('extends both server-only rate-limit allowlists and keeps them fail-closed', () => {
		expect(migration.match(/'patient_export_individual_by_user'/g)).toHaveLength(2);
		expect(migration.match(/'patient_export_global_by_business'/g)).toHaveLength(2);
		expect(migration).toContain(
			'revoke execute on function public.consume_server_rate_limits(text, text, jsonb)'
		);
		expect(migration).toContain(
			'grant execute on function public.consume_server_rate_limits(text, text, jsonb)'
		);
	});
});

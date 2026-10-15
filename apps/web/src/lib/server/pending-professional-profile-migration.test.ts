import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	resolve(process.cwd(), '../../supabase/migrations/20260731235900_pending_attending_profiles.sql'),
	'utf8'
);
const openSignupMigration = readFileSync(
	resolve(process.cwd(), '../../supabase/migrations/20260707165923_open_signup_rate_limits.sql'),
	'utf8'
);

describe('pending professional profile migration contract', () => {
	it('allows professional profiles only for owner, admin and professional roles', () => {
		expect(migration).toContain("professional_id is null\n\t\t\t\tor role in ('owner', 'admin', 'professional')");
		expect(migration).toContain('business_user_invites_professional_role_supported_chk');
		expect(migration).toContain('INVITED_PROFESSIONAL_BUSINESS_MISMATCH');
	});

	it('keeps every pending invited profile out of public booking', () => {
		expect(migration).toContain("invite.status = 'pending'");
		expect(migration).toContain('new.is_public := false');
		expect(migration).toContain('trg_enforce_pending_professional_visibility');
		expect(migration).toContain('trg_sync_invited_professional_account');
	});

	it('links and publishes the configured profile when the account accepts the invite', () => {
		expect(openSignupMigration).toContain('accepted_user_id = v_user_id');
		expect(openSignupMigration).toContain('where bui.id = v_invite.id');
		expect(migration).toContain("new.status = 'accepted' and new.accepted_user_id is not null");
		expect(migration).toContain(
			'insert into public.professional_users (business_id, professional_id, user_id)'
		);
		expect(migration).toContain('and professional.is_active');
		expect(migration).toContain('is_public = true');
	});

	it('preserves the profile between professional, admin and owner role changes', () => {
		expect(migration).toContain("if target_role not in ('owner', 'admin', 'professional') then");
		expect(migration).toContain("if target_role = 'professional' and not exists");
	});

	it('enforces administrative writes for profiles, services and schedules', () => {
		for (const policy of [
			'professionals_insert',
			'professionals_update',
			'professional_users_write',
			'services_insert',
			'services_update',
			'professional_services_write',
			'availability_rules_write',
			'availability_exceptions_write'
		]) {
			expect(migration).toContain(`create policy ${policy}`);
		}
		const policySection = migration.slice(migration.indexOf('drop policy if exists professionals_insert'));
		expect(policySection).toContain('public.user_can_manage_business(business_id)');
		expect(policySection).toContain('public.business_allows_operation(business_id)');
		expect(policySection).not.toContain('public.user_can_operate_business(business_id)');
	});
});

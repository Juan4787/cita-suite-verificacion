import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL('../../../../../supabase/migrations/20260831069000_revoke_legacy_identity_probes.sql', import.meta.url),
	'utf8'
);

describe('cierre de RPC heredadas de identidad', () => {
	it('revoca las sondas y conserva sólo al backend confiable', () => {
		expect(migration).toMatch(/accept_pending_business_invites_for_user\(text, uuid\)/i);
		expect(migration).toMatch(/business_commercial_status\(uuid\)/i);
		expect(migration).toMatch(/user_is_active_owner\(uuid, uuid\)/i);
		expect(migration).toMatch(/count_active_business_owners\(uuid\)/i);
		expect(migration).toMatch(/revoke all on function[\s\S]+from public, anon, authenticated/i);
		expect(migration).toMatch(/grant execute on function[\s\S]+to service_role/i);
		expect(migration).toContain("notify pgrst, 'reload schema'");
	});
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('allowed_emails policy migration', () => {
	it('elimina la política heredada que permitía SELECT global', () => {
		const migration = readFileSync(
			new URL('../../../../../supabase/migrations/20260831060000_restrict_allowed_emails_policy.sql', import.meta.url),
			'utf8'
		);

		expect(migration).toContain(
			'drop policy if exists allowed_emails_master_read on public.allowed_emails'
		);
		expect(migration).not.toMatch(/create\s+policy[\s\S]*using\s*\(\s*true\s*\)/i);
	});
});

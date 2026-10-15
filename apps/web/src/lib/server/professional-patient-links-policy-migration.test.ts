import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
	process.cwd(),
	'../../supabase/migrations/20260831066000_hide_archived_professional_links.sql'
);

describe('professional patient links policy migration', () => {
	it('limits direct professional reads to active links for the same professional and business', () => {
		const sql = fs.readFileSync(migrationPath, 'utf8');
		expect(sql).toMatch(/drop policy if exists professional_patient_links_select/i);
		expect(sql).toMatch(/coalesce\(public\.user_business_role\(business_id\), ''\) in \('owner', 'admin'\)/i);
		expect(sql).toMatch(/coalesce\(public\.user_business_role\(business_id\), ''\) = 'professional'/i);
		expect(sql).toMatch(/public\.business_allows_operation\(business_id\)/i);
		expect(sql).toMatch(/and is_active = true/i);
		expect(sql).toMatch(/pu\.user_id = auth\.uid\(\)/i);
	});
});

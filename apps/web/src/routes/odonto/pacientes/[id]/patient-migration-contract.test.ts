import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const readPeer = (relativePath: string) =>
	readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('patient migration contracts', () => {
	it('does not read clinical entry amount directly from clinical_entries in patient history endpoints', () => {
		const detailSource = readPeer('./+page.server.ts');
		const historySource = readPeer('./historial/+server.ts');
		const directAmountSelect = /from\('clinical_entries'\)[\s\S]{0,240}\.select\('[^']*\bamount\b/;

		expect(detailSource).not.toMatch(directAmountSelect);
		expect(historySource).not.toMatch(directAmountSelect);
	});

	it('does not archive, unarchive, or delete patients through direct table writes', () => {
		const detailSource = readPeer('./+page.server.ts');

		expect(detailSource).not.toMatch(/from\('patients'\)[\s\S]{0,160}\.delete\(/);
		expect(detailSource).not.toMatch(/from\('patients'\)[\s\S]{0,240}\.update\(\{[^}]*archived_at/);
	});

	it('does not create or update clinical entries through direct route table writes', () => {
		const detailSource = readPeer('./+page.server.ts');

		expect(detailSource).not.toMatch(/from\('clinical_entries'\)[\s\S]{0,120}\.insert\(/);
		expect(detailSource).not.toMatch(/from\('clinical_entries'\)[\s\S]{0,120}\.update\(/);
		expect(detailSource).toContain("'create_clinical_entry_with_result_safely'");
		expect(detailSource).toContain("rpc('update_clinical_entry_safely'");
	});

	it('persists a clinical entry with one patient metadata update and returns the saved row', () => {
		const migration = readPeer(
			'../../../../../../../supabase/migrations/20260823120000_fast_clinical_entry_result.sql'
		);

		expect(migration).toContain(
			'drop trigger if exists clinical_entries_sync_patient on public.clinical_entries'
		);
		expect(migration).toContain(
			'function public.create_clinical_entry_with_result_safely('
		);
		expect(migration).toContain("'locked_after', v_entry.locked_after");
		expect(migration).toContain('last_entry_at = greatest(');
		expect(migration).toContain(
			'v_result := public.create_clinical_entry_with_result_safely('
		);
	});
});

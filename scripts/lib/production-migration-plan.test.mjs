import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIRST_RECONCILED_MIGRATION, productionTransaction } from './production-migration-plan.mjs';

function project(migrations) {
	const root = mkdtempSync(join(tmpdir(), 'cita-migration-plan-'));
	mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
	mkdirSync(join(root, 'supabase/production'), { recursive: true });
	writeFileSync(join(root, 'supabase/production/reconcile-drift.sql'), '-- reconciliation\nselect 1;');
	for (const [name, body] of Object.entries(migrations)) writeFileSync(join(root, 'supabase/migrations', name), body);
	return root;
}
const migrations = {
	'20260101000000_applied.sql': 'begin;\nselect 0;\ncommit;\n',
	[FIRST_RECONCILED_MIGRATION]: 'begin;\ndo $$ begin perform 1; end $$;\ncommit;\n',
	'20261022010000_later.sql': 'begin;\nselect 2;\ncommit;\n'
};

test('one transaction: reconciliation once, migrations without their own transaction lines, then history', () => {
	const root = project(migrations);
	try {
		const { script, pending, ranges } = productionTransaction(root, ['20260101000000'], { finish: 'rollback' });
		assert.deepEqual(pending, [FIRST_RECONCILED_MIGRATION, '20261022010000_later.sql']);
		assert.deepEqual(ranges.map(range => range.name), ['supabase/production/reconcile-drift.sql', ...pending, 'history']);
		assert.equal(script.match(/^begin;$/gm).length, 1);
		assert.equal(script.match(/^commit;$/gm), null);
		assert.match(script, /rollback;\n$/);
		assert.match(script, /values \('20261022010000', 'later'\);/);
		// The second batch of a release runs no reconciliation.
		const contraction = productionTransaction(root, ['20260101000000', '20261016010000'], { finish: 'commit' });
		assert.deepEqual(contraction.ranges.map(range => range.name), ['20261022010000_later.sql', 'history']);
		assert.match(contraction.script, /commit;\n$/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('a batch stops at its version, and an empty batch or another history is refused', () => {
	const root = project(migrations);
	try {
		assert.deepEqual(productionTransaction(root, ['20260101000000'], { finish: 'commit', until: '20261016010000' }).pending, [FIRST_RECONCILED_MIGRATION]);
		assert.throws(() => productionTransaction(root, ['20260101000000'], { finish: 'commit', until: '20260101000001' }), /No pending migration/);
		assert.throws(() => productionTransaction(root, ['20250101000000'], { finish: 'commit' }), /not a prefix/);
		assert.throws(() => productionTransaction(root, ['20260101000000'], { finish: 'commit', until: 'latest' }), /exact migration version/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('a migration that would close the shared transaction is refused before anything is sent', () => {
	const root = project({ ...migrations, '20261022020000_closes.sql': 'begin;\nselect 3;\ncommit;\nselect 4;\ncommit;\n' });
	try {
		assert.throws(() => productionTransaction(root, ['20260101000000'], { finish: 'commit' }), /transaction control outside/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

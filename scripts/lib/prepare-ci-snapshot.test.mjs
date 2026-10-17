import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('snapshot preparation itself refuses a changed approved plan before creating Git state or evidence', () => {
	const original = fileURLToPath(new URL('../../', import.meta.url));
	const root = mkdtempSync(join(tmpdir(), 'cita-plan-negative-'));
	try {
		mkdirSync(join(root, 'scripts/lib'), { recursive: true });
		mkdirSync(join(root, 'docs/plans'), { recursive: true });
		for (const path of ['scripts/prepare-ci-snapshot.mjs', 'scripts/lib/plan-integrity.mjs',
			'docs/plans/refactorizacion-cita-suite.md', 'docs/plans/refactorizacion-cita-suite.integridad.json']) {
			cpSync(join(original, path), join(root, path));
		}
		const plan = join(root, 'docs/plans/refactorizacion-cita-suite.md');
		writeFileSync(plan, readFileSync(plan, 'utf8') + '\nUnapproved change\n');
		const result = spawnSync(process.execPath, ['scripts/prepare-ci-snapshot.mjs'], { cwd: root, encoding: 'utf8' });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /approved plan or execution instructions changed/);
		assert.equal(existsSync(join(root, '.verification')), false);
		assert.equal(existsSync(join(root, '.git')), false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

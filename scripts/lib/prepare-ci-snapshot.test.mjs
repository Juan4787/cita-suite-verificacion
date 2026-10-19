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

test('public source snapshots exclude tracked environment variants while preserving public examples', () => {
	const original = fileURLToPath(new URL('../../', import.meta.url));
	const root = mkdtempSync(join(tmpdir(), 'cita-source-boundary-'));
	const copied = ['scripts/prepare-ci-snapshot.mjs', 'scripts/lib/plan-integrity.mjs',
		'docs/plans/refactorizacion-cita-suite.md', 'docs/plans/refactorizacion-cita-suite.integridad.json'];
	const required = ['apps/web/src/hooks.server.ts', 'apps/web/src/lib/server/platform/supabase.ts',
		'apps/natalia/src/pages/index.astro', 'apps/scheduler/wrangler.jsonc', 'packages/shared/src/database.types.ts', 'supabase/config.toml'];
	const privateFiles = ['apps/web/.env', 'apps/web/.env.local', 'apps/web/.env.production.local',
		'apps/web/.dev.vars', 'apps/web/.dev.vars.staging'];
	const examples = ['.env.example', 'apps/web/.env.example', 'apps/web/.dev.vars.example'];
	const archive = 'docs/archive/administrativo-inactivo/integridad.json';
	const create = (path, content) => {
		mkdirSync(join(root, path, '..'), { recursive: true });
		writeFileSync(join(root, path), content);
	};
	const git = args => {
		const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	try {
		for (const path of copied) create(path, readFileSync(join(original, path)));
		for (const path of required) create(path, '// Synthetic source boundary fixture\n');
		for (const path of privateFiles) create(path, 'SYNTHETIC_SECRET=must-not-be-in-public-snapshot\n');
		for (const path of examples) create(path, 'EXAMPLE=placeholder\n');
		create(archive, '[]');
		git(['init', '--quiet']);
		git(['config', 'user.name', 'Synthetic verification']);
		git(['config', 'user.email', 'synthetic@example.test']);
		git(['add', '--force', '--', ...copied, ...required, ...privateFiles, ...examples, archive]);
		git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic source fixture']);
		const before = git(['rev-parse', 'HEAD']);
		const result = spawnSync(process.execPath, ['scripts/prepare-ci-snapshot.mjs'], { cwd: root, encoding: 'utf8', timeout: 15000 });
		assert.equal(result.status, 0, result.stderr);
		const manifest = JSON.parse(readFileSync(join(root, '.verification/ci-source.json'), 'utf8')).manifest;
		for (const path of privateFiles) assert.equal(manifest.some(file => file.path === path), false, path);
		for (const path of [...required, ...examples]) assert.equal(manifest.some(file => file.path === path), true, path);
		assert.equal(git(['rev-parse', 'HEAD']), before);
		assert.equal(git(['diff', '--cached', '--name-only']), '');
		// Reproduce a newly referenced root script silently omitted by the narrow
		// new-source scope. Failure must happen before changing the snapshot ref.
		const previousSnapshot = git(['rev-parse', 'refs/verification/maintainability-20261015']);
		create('scripts/verify-campaign.mjs', "const step = ['performance', 'node', ['scripts/new-runtime-check.mjs']];\n");
		create('scripts/new-runtime-check.mjs', '// Synthetic new entry point\n');
		const missing = spawnSync(process.execPath, ['scripts/prepare-ci-snapshot.mjs'], { cwd: root, encoding: 'utf8', timeout: 15000 });
		assert.equal(missing.status, 1);
		assert.match(missing.stderr, /entry point missing from CI source snapshot/);
		assert.equal(git(['rev-parse', 'refs/verification/maintainability-20261015']), previousSnapshot);
		git(['add', '--', 'scripts/new-runtime-check.mjs']);
		const staged = git(['diff', '--cached', '--name-only']);
		const complete = spawnSync(process.execPath, ['scripts/prepare-ci-snapshot.mjs'], { cwd: root, encoding: 'utf8', timeout: 15000 });
		assert.equal(complete.status, 0, complete.stderr);
		assert.equal(git(['diff', '--cached', '--name-only']), staged);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

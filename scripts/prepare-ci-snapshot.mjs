import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertApprovedPlan } from './lib/plan-integrity.mjs';

// Prepare an exact source snapshot without changing the user's index, branch or
// working tree. This script does not create a repository or push anything.
const root = fileURLToPath(new URL('../', import.meta.url));
// Keep the gate inside this command too. A separate preceding shell command
// can fail while the caller still prepares/pushes an invalid source snapshot.
assertApprovedPlan(
	readFileSync(join(root, 'docs/plans/refactorizacion-cita-suite.md'), 'utf8'),
	JSON.parse(readFileSync(join(root, 'docs/plans/refactorizacion-cita-suite.integridad.json'), 'utf8'))
);
const temporary = mkdtempSync(join(tmpdir(), 'cita-ci-index-'));
const gitEnv = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') };
const directory = join(root, '.verification');
mkdirSync(directory, { recursive: true });
function git(args, input) {
	const result = spawnSync('git', args, { cwd: root, env: gitEnv, input, encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 });
	if (result.status !== 0 || result.error) throw new Error('Could not prepare isolated CI source: ' + (result.stderr || result.error?.message));
	return result.stdout.trim();
}
const rootFiles = new Set(['.env.example', '.gitignore', '.npmrc', 'AGENTS.md', 'README.md',
	'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json',
	'.dependency-cruiser.cjs', '.node-version', '.prettierignore']);
const extras = [
	'.github/workflows/refactoring-verification.yml', '.github/workflows/staging-connectivity.yml',
	'scripts/inspect-staging-database.mjs',
	'docs/plans/refactorizacion-cita-suite.md', 'docs/plans/refactorizacion-cita-suite.integridad.json',
	'docs/plans/registro-refactorizacion-cita-suite.md',
	'docs/architecture/base-de-campana.md', 'docs/architecture/verificacion.md',
	'docs/architecture/identidad-cita-suite.md', 'docs/architecture/relaciones-entre-consultorios.md',
	'docs/architecture/tipado-contexto-aislamiento.md', 'docs/architecture/contabilidad-documentos.md',
	'docs/architecture/evidencia-etapa3-documentos.md',
	'docs/architecture/revision-ui-documentos.md',
	'docs/architecture/disponibilidad-y-aranceles.md',
	'docs/architecture/evidencia-etapa4-agenda.md',
	'docs/architecture/revision-ui-agenda-aranceles.md',
	'docs/architecture/areas-y-fronteras.md',
	'docs/archive/administrativo-inactivo/README.md', 'docs/archive/administrativo-inactivo/integridad.json',
	...JSON.parse(readFileSync(join(root, 'docs/archive/administrativo-inactivo/integridad.json'), 'utf8')).map(entry => entry.archive),
	'docs/architecture/functional-contracts.md', 'docs/architecture/refactoring-campaign.md',
	'scripts/catalog-disposable-database.mjs', 'scripts/check-refactoring-plan.mjs',
	'scripts/inventory-campaign.mjs', 'scripts/run-campaign-integration.mjs',
	'scripts/run-campaign-demo.mjs', 'scripts/verify-campaign.mjs',
	'scripts/verify-campaign-staging.mjs', 'scripts/prepare-ci-snapshot.mjs',
	'scripts/prepare-ci-services.mjs',
	'scripts/run-campaign-unit-tests.mjs', 'scripts/run-campaign-node-tests.mjs', 'apps/web/vitest.office.config.ts',
	'scripts/test-verification-evidence.py',
	'scripts/generate-database-types.mjs', 'scripts/run-campaign-type-generation.mjs',
	'scripts/package-verification-evidence.py', 'scripts/collect-verification-evidence.py',
	...readdirSync(join(root, 'scripts/lib')).filter(name => name.endsWith('.mjs')).map(name => 'scripts/lib/' + name)
];
function permitted(path) {
	if (path.split('/').some(part =>
		(part.startsWith('.env') && part !== '.env.example') ||
		((part === '.dev.vars' || part.startsWith('.dev.vars.')) && part !== '.dev.vars.example')) ||
		path.includes('/output/') || path.includes('/dist/') || path.includes('/test-results/')) return false;
	return rootFiles.has(path) || /^(?:apps|packages|supabase|scripts)\//.test(path);
}
try {
	// Enumerate using the real index before building the independent one. An
	// empty temporary index cannot tell us which application files are tracked.
	const listing = spawnSync('git', ['ls-files', '-z'], { cwd: root, env: process.env, encoding: 'utf8' });
	if (listing.status !== 0) throw new Error('Could not enumerate the actual source checkout.');
	const tracked = listing.stdout.split('\0').filter(Boolean).filter(permitted);
	const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z', '--',
		'apps/web/src', 'apps/web/e2e', 'apps/natalia/src', 'packages/shared/src', 'supabase/migrations', 'supabase/tests', 'scripts/lib'],
		{ cwd: root, env: process.env, encoding: 'utf8' });
	if (untracked.status !== 0) throw new Error('Could not enumerate scoped new source files.');
	const newSource = untracked.stdout.split('\0').filter(Boolean).filter(permitted).filter(path => /\.(?:ts|svelte|js|mjs|sql|sh|astro|css|json)$/.test(path));
	const selected = [...new Set([...tracked, ...newSource, ...rootFiles, ...extras])].filter(path => existsSync(join(root, path))).sort();
	for (const required of ['apps/web/src/hooks.server.ts', 'apps/web/src/lib/server/platform/supabase.ts',
		'apps/natalia/src/pages/index.astro', 'packages/shared/src/database.types.ts', 'supabase/config.toml'])
		if (!selected.includes(required)) throw new Error('Incomplete CI source snapshot: ' + required);
	const records = [];
	const manifest = [];
	let bytes = 0;
	for (const path of selected) {
		if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('Invalid source path.');
		const absolute = join(root, path);
		const stat = lstatSync(absolute);
		if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('Only individual source files are accepted.');
		const contents = stat.isSymbolicLink() ? Buffer.from(readlinkSync(absolute)) : readFileSync(absolute);
		const mode = stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644';
		const blob = git(['hash-object', '-w', '--stdin', '--no-filters'], contents);
		if (!/^[0-9a-f]{40}$/.test(blob)) throw new Error('Unexpected Git object format.');
		records.push(`${mode} ${blob}\t${path}\0`);
		manifest.push({ path, mode, blob, bytes: contents.length });
		bytes += contents.length;
	}
	git(['read-tree', '--empty']);
	git(['update-index', '-z', '--index-info'], records.join(''));
	const tree = git(['write-tree']);
	const sourceRevision = git(['rev-parse', 'HEAD']);
	const previous = spawnSync('git', ['rev-parse', '--verify', 'refs/verification/maintainability-20261015'], { cwd: root, encoding: 'utf8' });
	const parent = previous.status === 0 ? ['-p', previous.stdout.trim()] : [];
	const commit = git(['-c', 'commit.gpgsign=false', 'commit-tree', tree, ...parent], `Isolated verification snapshot from ${sourceRevision}\n`);
	git(['update-ref', 'refs/verification/maintainability-20261015', commit]);
	const sourceDigest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
	writeFileSync(join(directory, 'ci-source.json'), JSON.stringify({
		commit, tree, sourceRevision, sourceDigest, bytes, files: manifest.length,
		scope: 'Selected application source and verification contracts only. No environment credentials, private attachments, output artifacts, user index changes or production publication.',
		manifest
	}, null, 2) + '\n');
	console.log(JSON.stringify({ commit, tree, sourceDigest, files: manifest.length, bytes }));
} finally { rmSync(temporary, { recursive: true }); }

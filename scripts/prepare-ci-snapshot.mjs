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
	'.github/workflows/staging-operations.yml', '.github/workflows/production-measurement.yml', 'apps/web/wrangler.staging.jsonc',
	'scripts/inspect-staging-database.mjs', 'scripts/apply-staging-migrations.mjs', 'scripts/staging-queue-scenario.mjs',
	'scripts/deploy-staging-workers.mjs', 'scripts/tail-metrics.mjs', 'scripts/staging-device-push.mjs',
	'scripts/run-campaign-capacity.mjs', 'scripts/capacity/seed-practices.sql', 'scripts/capacity/cleanup-practices.sql', 'scripts/staging-capacity.mjs', 'scripts/backup-rehearsal.mjs', 'scripts/backup-production.mjs', 'scripts/instance-sampler.mjs', 'scripts/attribute-pauses.mjs', 'scripts/apply-production-migrations.mjs', 'scripts/deploy-production-workers.mjs', 'scripts/production-capacity.mjs',
	'scripts/package-release-artifact.mjs', 'scripts/staging-release-fixture.mjs', 'scripts/check-api-exposure.mjs',
	'scripts/compare-access-catalog.mjs', 'scripts/rehearse-production-migrations.mjs', 'scripts/production-legacy-jobs.mjs', 'scripts/production-device-push.mjs', 'scripts/release-smoke.mjs',
	'scripts/verify-production-release.mjs', 'scripts/check-previous-scheduler.mjs', 'supabase/production/reconcile-drift.sql',
	'scripts/prepare-natalia-publication.mjs',
	'scripts/staging/push-sink/supabase/config.toml', 'scripts/staging/push-sink/supabase/functions/push-sink/index.ts',
	'docs/README.md', 'docs/architecture/inventario-documental-20261022.json',
	'docs/architecture/clave-de-servicio.md', 'docs/booking-integration/activation.md',
	'docs/plans/refactorizacion-cita-suite.md', 'docs/plans/refactorizacion-cita-suite.integridad.json',
	'docs/plans/registro-refactorizacion-cita-suite.md',
	'docs/architecture/base-de-campana.md', 'docs/architecture/verificacion.md',
	'docs/architecture/accesos-google.md', 'docs/architecture/acceso-google-calendar.md',
	'docs/architecture/identidad-cita-suite.md', 'docs/architecture/identidad-ensayo-github.json', 'docs/architecture/relaciones-entre-consultorios.md',
	'docs/architecture/tipado-contexto-aislamiento.md', 'docs/architecture/contabilidad-documentos.md',
	'docs/architecture/evidencia-etapa3-documentos.md',
	'docs/architecture/revision-ui-documentos.md',
	'docs/architecture/disponibilidad-y-aranceles.md',
	'docs/architecture/evidencia-etapa4-agenda.md',
	'docs/architecture/revision-ui-agenda-aranceles.md',
	'docs/architecture/revision-ui-estructura.md',
	'docs/architecture/etapa5-capturas.json',
	'docs/architecture/areas-y-fronteras.md', 'docs/architecture/guia-nuevas-funciones.md',
	'docs/architecture/evidencia-etapa5-estructura.md', 'docs/plans/traspaso-refactorizacion-cita-suite.md',
	'docs/architecture/tareas-automaticas.md', 'docs/architecture/capacidad.md', 'docs/architecture/matriz-regresiones.md', 'docs/architecture/control-de-consumo.md', 'docs/architecture/respaldo-y-recuperacion.md', 'docs/architecture/publicacion-y-reversion.md', 'docs/architecture/permisos-y-capacidades.md', 'docs/architecture/decisiones.md', 'docs/architecture/auditoria-final.md',
	'docs/architecture/module-relocations.json',
	'docs/archive/administrativo-inactivo/README.md', 'docs/archive/administrativo-inactivo/integridad.json',
	...JSON.parse(readFileSync(join(root, 'docs/archive/administrativo-inactivo/integridad.json'), 'utf8')).map(entry => entry.archive),
	'docs/architecture/functional-contracts.md', 'docs/architecture/refactoring-campaign.md',
	'scripts/catalog-disposable-database.mjs', 'scripts/check-refactoring-plan.mjs',
	'scripts/inventory-campaign.mjs', 'scripts/run-campaign-integration.mjs',
	'scripts/run-campaign-demo.mjs', 'scripts/verify-campaign.mjs',
	'scripts/measure-natalia-baseline.mjs',
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
		'apps/web/src', 'apps/web/e2e', 'apps/natalia/src', 'apps/scheduler', 'packages/shared/src', 'supabase/migrations', 'supabase/tests', 'scripts/lib'],
		{ cwd: root, env: process.env, encoding: 'utf8' });
	if (untracked.status !== 0) throw new Error('Could not enumerate scoped new source files.');
	const newSource = untracked.stdout.split('\0').filter(Boolean).filter(permitted).filter(path => /\.(?:ts|svelte|js|mjs|sql|sh|astro|css|json|jsonc)$/.test(path));
	const selected = [...new Set([...tracked, ...newSource, ...rootFiles, ...extras])].filter(path => existsSync(join(root, path))).sort();
	for (const required of ['apps/web/src/hooks.server.ts', 'apps/web/src/lib/server/platform/supabase.ts',
		'apps/natalia/src/pages/index.astro', 'apps/scheduler/wrangler.jsonc', 'packages/shared/src/database.types.ts', 'supabase/config.toml'])
		if (!selected.includes(required)) throw new Error('Incomplete CI source snapshot: ' + required);
	// Reject a verifier that invokes a new untracked entry point outside the
	// explicit source scope. Do not discover arbitrary unrelated local scripts.
	for (const entry of ['scripts/verify-campaign.mjs', 'scripts/run-campaign-integration.mjs', 'scripts/run-campaign-demo.mjs']) {
		if (!existsSync(join(root, entry))) continue;
		const source = readFileSync(join(root, entry), 'utf8');
		for (const match of source.matchAll(/['"](scripts\/[\w./-]+\.(?:mjs|py))['"]/g)) {
			if (!selected.includes(match[1])) throw new Error('Verification entry point missing from CI source snapshot: ' + match[1]);
		}
	}
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

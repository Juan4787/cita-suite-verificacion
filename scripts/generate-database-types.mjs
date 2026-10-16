import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fixturePath } from './lib/fixture-path.mjs';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';
import { acquireVerificationLock } from './lib/verification-lock.mjs';

// This is the official generator used by the pinned Supabase CLI, invoked on
// our owned internal network so it cannot pick a linked or production project.
const image = 'public.ecr.aws/supabase/postgres-meta:v0.98.0';
const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (process.argv.length !== 3 || !['--export', '--check', '--write'].includes(mode))
	throw new Error('Usage: generate-database-types.mjs --export|--check|--write (owned CI database only).');
assertHostedIntegrationResources();
const lease = acquireVerificationLock(root);
function docker(args) {
	const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 ** 2 });
	if (result.status !== 0 || result.error) throw new Error('Disposable type generation failed: ' + (result.stderr || result.error?.message));
	return result.stdout;
}
try {
	const receipt = JSON.parse(readFileSync(fixturePath('database.json'), 'utf8'));
	if (!/^cita-booking-test-[a-f0-9]{12}$/.test(receipt.container) || receipt.network !== receipt.container + '-net')
		throw new Error('Types require an owned reconstructed database.');
	const database = JSON.parse(docker(['inspect', receipt.container]))[0];
	if (database.Config.Labels['com.cita-suite.booking-fixture'] !== 'true' ||
		database.Config.Labels['com.cita-suite.fixture-run'] !== receipt.runId ||
		!database.NetworkSettings.Networks[receipt.network]) throw new Error('Type generator database ownership mismatch.');
	const meta = JSON.parse(docker(['image', 'inspect', image]))[0];
	const args = ['run', '--rm', '--pull=never', '--network', receipt.network,
		'--memory', '512m', '--cpus', '1', '--label', 'com.cita-suite.booking-fixture=true',
		'--label', 'com.cita-suite.fixture-run=' + receipt.runId,
		'-e', 'NODE_OPTIONS=--max-old-space-size=256',
		'-e', `PG_META_DB_URL=postgresql://supabase_admin:cita-disposable-test-only@${receipt.container}:5432/postgres?sslmode=disable`,
		'-e', 'PG_CONN_TIMEOUT_SECS=10', '-e', 'PG_QUERY_TIMEOUT_SECS=30',
		'-e', 'PG_META_GENERATE_TYPES=typescript', '-e', 'PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public',
		'-e', 'PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true', image, 'node', 'dist/server/server.js'];
	const normalize = text => text.trimEnd() + '\n';
	const source = normalize(docker(args));
	const again = normalize(docker(args));
	if (source !== again) throw new Error('Generated types are not reproducible on the same reconstructed database.');
	const ts = createRequire(join(root, 'apps/web/package.json'))('typescript');
	const parsed = ts.createSourceFile('database.types.ts', source, ts.ScriptTarget.Latest, true);
	if (parsed.parseDiagnostics.length || !source.includes('export type Database =') ||
		!source.includes('businesses:') || !source.includes('list_user_business_contexts:'))
		throw new Error('The generator returned invalid or incomplete application types. No source file changed.');
	const migrations = readdirSync(join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
	const migrationDigest = createHash('sha256');
	for (const name of migrations) migrationDigest.update(name + '\0').update(readFileSync(join(root, 'supabase/migrations', name)));
	const evidence = { generator: image, imageId: meta.Id, migrationsSha256: migrationDigest.digest('hex'),
		sha256: createHash('sha256').update(source).digest('hex'), reproducible: true, source,
		scope: 'Public schema from all migrations on an owned disposable database; not production.' };
	mkdirSync(join(root, '.verification'), { recursive: true });
	writeFileSync(join(root, '.verification/generated-database-types.json'), JSON.stringify(evidence, null, 2) + '\n');
	const target = join(root, 'packages/shared/src/database.types.ts');
	if (mode === '--check' && readFileSync(target, 'utf8') !== source)
		throw new Error('Database types drift from the reconstructed migrations. Regenerate and review the changes.');
	if (mode === '--write') {
		writeFileSync(target + '.tmp', source);
		renameSync(target + '.tmp', target);
	}
	console.log(JSON.stringify({ generator: image, mode, sha256: evidence.sha256, bytes: Buffer.byteLength(source), reproducible: true }));
} finally { lease.release(); }

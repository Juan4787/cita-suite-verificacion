import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { psqlDiagnostics } from './lib/staging-database.mjs';

// Applies the versioned migrations to production, from this machine, as
// apply-staging-migrations.mjs does for staging: in order, each file as the disposable
// reconstruction applies it, recording the CLI history after each success. It refuses to
// start without a production backup (backup-production.mjs) taken at the current migration
// state within the last six hours, and when the history is not a prefix of the local list.
const PRODUCTION_REF = 'yjzferwuzbtgpmdnzlcb';
const root = fileURLToPath(new URL('../', import.meta.url));
const [backupDirectory] = process.argv.slice(2);
if (!backupDirectory || process.argv.length !== 3) throw new Error('Usage: apply-production-migrations.mjs <backup directory>');
const env = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split('\n')
	.map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter(Boolean)
	.map(([, key, value]) => [key, value.replace(/^["']|["']$/g, '')]));
let database;
try { database = new URL(env.SUPABASE_DB_URL); } catch { throw new Error('The production connection is missing or invalid. Nothing was applied.'); }
if (!/^aws-\d+-sa-east-1\.pooler\.supabase\.com$/.test(database.hostname) || decodeURIComponent(database.username) !== `postgres.${PRODUCTION_REF}`
	|| database.pathname !== '/postgres' || !database.password)
	throw new Error('The connection is not the production project. Nothing was applied.');
// A session, so each file runs as one psql session does in the reconstruction.
database.port = '5432';
const redact = (text) => String(text ?? '').replaceAll(decodeURIComponent(database.password), '[secret]');

function psql(args, input) {
	const result = spawnSync('psql', ['-X', '-h', database.hostname, '-p', database.port, '-U', decodeURIComponent(database.username), '-d', 'postgres',
		'-v', 'ON_ERROR_STOP=1', ...args], {
		input, encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 ** 2,
		env: { ...process.env, PGPASSWORD: decodeURIComponent(database.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10',
			PGAPPNAME: 'cita_suite_production_migrations' }
	});
	return { ...result, stderr: redact(result.stderr) };
}
const query = (sql) => {
	const result = psql(['-Atq', '-c', sql]);
	if (result.error || result.status !== 0) throw new Error('Production query failed.\n' + psqlDiagnostics(result.stderr));
	return result.stdout.trim();
};

const files = readdirSync(join(root, 'supabase/migrations')).filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)).sort();
const local = files.map((file) => ({ file, version: file.slice(0, 14), name: file.slice(15, -4) }));
const applied = JSON.parse(query("select coalesce(json_agg(version order by version), '[]'::json) from supabase_migrations.schema_migrations"));
if (applied.some((version, index) => local[index]?.version !== version))
	throw new Error('The production history is not a prefix of the versioned migrations. Nothing was applied.');

// The backup must be of production, recent, and of this same migration state.
const manifestPath = join(backupDirectory, 'manifest.json');
if (!existsSync(manifestPath)) throw new Error('No backup manifest in that directory. Nothing was applied.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const backupAge = Date.now() - Date.parse(manifest.createdAt);
if (manifest.source?.projectRef !== PRODUCTION_REF || !(backupAge >= 0 && backupAge < 6 * 3600_000)
	|| JSON.stringify(manifest.migrations.map(([version]) => version)) !== JSON.stringify(applied))
	throw new Error('The backup is not a production backup of the current state taken in the last six hours. Nothing was applied.');

const receipt = { projectRef: PRODUCTION_REF, backup: { directory: backupDirectory, createdAt: manifest.createdAt }, before: applied.length, applied: [], startedAt: new Date().toISOString() };
for (const migration of local.slice(applied.length)) {
	const contents = readFileSync(join(root, 'supabase/migrations', migration.file));
	const started = performance.now();
	const result = psql(['-q', '-f', '-'], contents);
	if (result.error || result.status !== 0) {
		receipt.failed = { file: migration.file, diagnostics: psqlDiagnostics(result.stderr) };
		break;
	}
	query(`insert into supabase_migrations.schema_migrations(version, name) values ('${migration.version}', '${migration.name}')`);
	receipt.applied.push({ file: migration.file, sha256: createHash('sha256').update(contents).digest('hex'), durationMs: Math.round(performance.now() - started) });
}
receipt.after = applied.length + receipt.applied.length;
receipt.finishedAt = new Date().toISOString();
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, `.verification/production-migrations-${receipt.startedAt.slice(0, 10)}.json`), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
if (receipt.failed || receipt.after !== local.length) process.exitCode = 1;

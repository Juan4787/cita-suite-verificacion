import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_REF, productionEnvironment } from './lib/production-database.mjs';
import { productionTransaction, sourceOf } from './lib/production-migration-plan.mjs';
import { psqlDiagnostics } from './lib/staging-database.mjs';

// Applies production's pending database changes from this machine as one transaction: the
// reconciliation of its drift (supabase/production/reconcile-drift.sql), every pending migration
// and their history. All of it applies, or nothing does; rehearse-production-migrations.mjs runs the
// same transaction and rolls it back. It refuses to start without a production backup
// (backup-production.mjs) taken at the current migration state within the last six hours, and when
// the history is not a prefix of the local list.
const root = fileURLToPath(new URL('../', import.meta.url));
const [backupDirectory, untilOption] = process.argv.slice(2);
const until = untilOption?.startsWith('--until=') ? untilOption.slice('--until='.length) : null;
if (!backupDirectory || process.argv.length > 4 || (untilOption && until === null))
	throw new Error('Usage: apply-production-migrations.mjs <backup directory> [--until=<migration version>]');
// A session on port 5432, so the transaction runs as one psql session does in the reconstruction.
const { database } = productionEnvironment(root);
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
const history = () => {
	const result = psql(['-Atq', '-c', "select coalesce(json_agg(version order by version), '[]'::json) from supabase_migrations.schema_migrations"]);
	if (result.error || result.status !== 0) throw new Error('Production query failed.\n' + psqlDiagnostics(result.stderr));
	return JSON.parse(result.stdout.trim());
};

const applied = history();
// The backup must be of production, recent, and of this same migration state.
const manifestPath = join(backupDirectory, 'manifest.json');
if (!existsSync(manifestPath)) throw new Error('No backup manifest in that directory. Nothing was applied.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const backupAge = Date.now() - Date.parse(manifest.createdAt);
if (manifest.source?.projectRef !== PRODUCTION_REF || !(backupAge >= 0 && backupAge < 6 * 3600_000)
	|| JSON.stringify(manifest.migrations.map(([version]) => version)) !== JSON.stringify(applied))
	throw new Error('The backup is not a production backup of the current state taken in the last six hours. Nothing was applied.');

const { script, ranges, pending } = productionTransaction(root, applied, { finish: 'commit', until, before: '\\set VERBOSITY terse\n\\set SHOW_CONTEXT never' });
const receipt = { projectRef: PRODUCTION_REF, backup: { directory: backupDirectory, createdAt: manifest.createdAt }, before: applied.length,
	until, reconciliation: ranges.some((range) => range.name === 'supabase/production/reconcile-drift.sql')
		? createHash('sha256').update(readFileSync(join(root, 'supabase/production/reconcile-drift.sql'))).digest('hex') : null,
	pending: pending.map((file) => ({ file, sha256: createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', file))).digest('hex') })),
	startedAt: new Date().toISOString() };
const started = performance.now();
const result = psql(['-q', '-f', '-'], script);
receipt.durationMs = Math.round(performance.now() - started);
if (result.error || result.status !== 0) {
	const failure = /psql:<stdin>:(\d+):\s*(?:ERROR|FATAL):\s*(.*)/.exec(result.stderr ?? '');
	receipt.failed = { source: failure ? sourceOf(ranges, Number(failure[1])) : 'transaction', message: failure?.[2]?.slice(0, 300) ?? psqlDiagnostics(result.stderr) };
}
// The history says what was committed: everything or nothing.
receipt.after = history().length;
receipt.finishedAt = new Date().toISOString();
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, `.verification/production-migrations-${receipt.startedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
if (receipt.failed || receipt.after !== applied.length + pending.length) process.exitCode = 1;

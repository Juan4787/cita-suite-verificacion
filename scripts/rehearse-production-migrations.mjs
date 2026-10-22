import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_QUERY, compareCatalogs } from './lib/access-catalog.mjs';
import { PRODUCTION_REF, productionEnvironment, readEnvFile } from './lib/production-database.mjs';
import { productionTransaction, sourceOf } from './lib/production-migration-plan.mjs';
import { psqlDiagnostics, stagingConnection } from './lib/staging-database.mjs';

// The publication transaction (reconciliation, pending migrations and history) run against
// production's real schema and always rolled back: nothing is kept, and a lost connection rolls
// back too. psql's ON_ERROR_ROLLBACK lets one pass list every failing statement. Before the
// rollback, the resulting catalog is read and compared with staging's, which is built only from
// the migrations: what remains different is what publishing would leave. Locks wait at most five
// seconds; messages are terse, so a failing statement never prints the values of a row.
const root = fileURLToPath(new URL('../', import.meta.url));
const untilOption = process.argv[2];
const until = untilOption?.startsWith('--until=') ? untilOption.slice('--until='.length) : null;
if (process.argv.length > 3 || (untilOption && until === null)) throw new Error('Usage: rehearse-production-migrations.mjs [--until=<migration version>]');
const { database: url } = productionEnvironment(root);
const staging = stagingConnection(readEnvFile(join(homedir(), '.config/cita-suite/staging/connection.env')).CITA_STAGING_DATABASE_URL);
const psql = (target, input, args, application) => spawnSync('psql', ['-X', '-h', target.hostname, '-p', target.port, '-U', decodeURIComponent(target.username),
	'-d', 'postgres', ...args, '-f', '-'], { input, encoding: 'utf8', timeout: 600_000, maxBuffer: 32 * 1024 ** 2,
	env: { ...process.env, PGPASSWORD: decodeURIComponent(target.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10', PGAPPNAME: application } });
const redact = (target, text) => psqlDiagnostics(text).replaceAll(decodeURIComponent(target.password), '[secret]');

const history = psql(url, 'begin transaction read only;\nselect version from supabase_migrations.schema_migrations order by version;\ncommit;\n',
	['-v', 'ON_ERROR_STOP=1', '-Atq'], 'cita_suite_migration_rehearsal');
if (history.status !== 0) throw new Error('The migration history could not be read.\n' + redact(url, history.stderr));
const applied = history.stdout.trim().split('\n').filter(Boolean);

const directory = mkdtempSync(join(tmpdir(), 'cita-rehearsal-'));
try {
	const catalogFile = join(directory, 'catalog.json');
	const { script, ranges, pending } = productionTransaction(root, applied, { finish: 'rollback', until,
		before: '\\set ON_ERROR_ROLLBACK on\n\\set VERBOSITY terse\n\\set SHOW_CONTEXT never',
		after: `\\o ${catalogFile}\n${CATALOG_QUERY}\n\\o` });
	const result = psql(url, script, ['-v', 'ON_ERROR_STOP=0', '-Atq'], 'cita_suite_migration_rehearsal');
	const failures = [...(result.stderr ?? '').matchAll(/psql:<stdin>:(\d+):\s*(ERROR|FATAL):\s*(.*)/g)]
		.map(match => ({ source: sourceOf(ranges, Number(match[1])), line: Number(match[1]), message: match[3].slice(0, 300) }));
	const read = psql(staging, `begin transaction read only;\n${CATALOG_QUERY}\ncommit;\n`, ['-v', 'ON_ERROR_STOP=1', '-Atq'], 'cita_suite_catalog_staging');
	if (read.status !== 0) throw new Error('The staging catalog could not be read.\n' + redact(staging, read.stderr));
	const differences = compareCatalogs(JSON.parse(read.stdout.trim()), JSON.parse(readFileSync(catalogFile, 'utf8').trim()));
	const receipt = { at: new Date().toISOString(), project: PRODUCTION_REF, applied: applied.length, until, pending, rolledBack: true,
		exitStatus: result.status, failures, differences };
	mkdirSync(join(root, '.verification'), { recursive: true });
	writeFileSync(join(root, `.verification/production-migration-rehearsal-${receipt.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(receipt, null, 2) + '\n');
	console.log(JSON.stringify({ applied: applied.length, pending: pending.length, failures: failures.length,
		differences: Object.fromEntries(Object.entries(differences).map(([section, entry]) =>
			[section, entry.onlyInMigrations.length + entry.onlyInProduction.length + entry.different.length])) }));
	for (const failure of failures) console.log(`FAIL ${failure.source}:${failure.line} ${failure.message}`);
	if (failures.length || result.status !== 0) process.exitCode = 1;
} finally { rmSync(directory, { recursive: true, force: true }); }

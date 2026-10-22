import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_QUERY, compareCatalogs } from './lib/access-catalog.mjs';
import { productionEnvironment, readEnvFile } from './lib/production-database.mjs';
import { psqlDiagnostics, stagingConnection } from './lib/staging-database.mjs';

// The catalog of production against staging, which is built only from the versioned migrations,
// read in read-only transactions. Objects of other products in the project are reported apart.
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length !== 2) throw new Error('Usage: compare-access-catalog.mjs');
const staging = stagingConnection(readEnvFile(join(homedir(), '.config/cita-suite/staging/connection.env')).CITA_STAGING_DATABASE_URL);
const { database: production } = productionEnvironment(root);

function catalog(url, application) {
	const result = spawnSync('psql', ['-X', '-h', url.hostname, '-p', url.port, '-U', decodeURIComponent(url.username), '-d', 'postgres',
		'-v', 'ON_ERROR_STOP=1', '-Atq', '-f', '-'], {
		input: `begin transaction read only;\nselect current_setting('transaction_read_only');\n${CATALOG_QUERY}\ncommit;\n`,
		encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 ** 2,
		env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10', PGAPPNAME: application } });
	if (result.error || result.status !== 0)
		throw new Error('The catalog could not be read.\n' + psqlDiagnostics(result.stderr).replaceAll(decodeURIComponent(url.password), '[secret]'));
	const [readOnly, ...rest] = result.stdout.trim().split('\n');
	if (readOnly !== 'on') throw new Error('The catalog was not read in a read-only transaction.');
	return JSON.parse(rest.join('\n'));
}

const expected = catalog(staging, 'cita_suite_catalog_staging');
const actual = catalog(production, 'cita_suite_catalog_production');
const differences = compareCatalogs(expected, actual);
const result = { at: new Date().toISOString(), staging: 'ikaudqoilclfnztkxubz', production: 'yjzferwuzbtgpmdnzlcb', differences,
	aligned: Object.values(differences).every(entry => !entry.onlyInMigrations.length && !entry.onlyInProduction.length && !entry.different.length),
	// Both catalogs are kept: privileges and metadata, with expressions only as digests.
	catalogs: { migrations: expected, production: actual } };
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, `.verification/access-catalog-${result.at.slice(0, 10)}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ aligned: result.aligned, ...Object.fromEntries(Object.entries(differences).map(([section, entry]) =>
	[section, { onlyInMigrations: entry.onlyInMigrations.length, onlyInProduction: entry.onlyInProduction.length, different: entry.different.length }])) }));
if (!result.aligned) process.exitCode = 1;

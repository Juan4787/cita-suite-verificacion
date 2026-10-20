import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGING_PROJECT_REF, psqlDiagnostics, stagingConnection, stagingPsql } from './lib/staging-database.mjs';

// Applies the versioned migrations to the dedicated staging project only: in order,
// each file as the disposable reconstruction applies it, and records the Supabase
// CLI history after each success so later pushes and audits read the same state.
// The history must be a prefix of the local list; anything else stops before writing.
const root = fileURLToPath(new URL('../', import.meta.url));
const url = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const options = '-c application_name=cita_suite_staging_migrations';
const query = sql => {
	const result = stagingPsql(url, ['-Atq', '-c', sql], { options });
	if (result.error || result.status !== 0) throw new Error('Staging query failed.\n' + psqlDiagnostics(result.stderr));
	return result.stdout.trim();
};

const files = readdirSync(join(root, 'supabase/migrations')).filter(file => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)).sort();
if (files.length === 0) throw new Error('No migrations found.');
const local = files.map(file => ({ file, version: file.slice(0, 14), name: file.slice(15, -4) }));

query('create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);');
const applied = JSON.parse(query("select coalesce(json_agg(version order by version), '[]'::json) from supabase_migrations.schema_migrations"));
if (applied.some((version, index) => local[index]?.version !== version))
	throw new Error('The staging history is not a prefix of the versioned migrations. Nothing was applied.');

const receipt = { projectRef: STAGING_PROJECT_REF, before: applied.length, applied: [], startedAt: new Date().toISOString() };
for (const migration of local.slice(applied.length)) {
	const contents = readFileSync(join(root, 'supabase/migrations', migration.file));
	const started = performance.now();
	const result = stagingPsql(url, ['-q', '-f', '-'], { input: contents, options });
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
writeFileSync(join(root, '.verification/staging-migrations.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
if (receipt.failed || receipt.after !== local.length) process.exit(1);

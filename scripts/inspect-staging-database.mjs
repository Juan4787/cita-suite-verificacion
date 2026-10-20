import { STAGING_PROJECT_REF as projectRef, stagingConnection, stagingPsql } from './lib/staging-database.mjs';

// Read-only preparation. Never infer a target from .env or a CLI link.
const url = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const sql = `select json_build_object(
 'database',current_database(),'user',current_user,'version',version(),
 'publicTables',(select count(*) from pg_tables where schemaname='public'),
 'privateTables',(select count(*) from pg_tables where schemaname='private'),
 'authUsers',(select count(*) from auth.users),
 'storageBuckets',(select count(*) from storage.buckets),
 'migrationHistoryPresent',to_regclass('supabase_migrations.schema_migrations') is not null);`;
const result = stagingPsql(url, ['-Atq', '-c', sql], {
	timeout: 25_000,
	options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c application_name=cita_suite_staging_audit'
});
if (result.error || result.status !== 0) {
	// Driver errors can contain connection strings; never print their body.
	const auth = /password authentication|authentication failed|wrong password/i.test(result.stderr ?? '');
	console.log(JSON.stringify({ projectRef, readOnly: true, connected: false, category: auth ? 'authentication' : 'connection' }));
	process.exit(1);
}
let inspection;
try { inspection = JSON.parse(result.stdout); } catch { throw new Error('Invalid read-only inspection response.'); }
if (inspection.database !== 'postgres' || !Number.isSafeInteger(inspection.publicTables) || !Number.isSafeInteger(inspection.authUsers))
	throw new Error('Incomplete read-only inspection response.');
console.log(JSON.stringify({ projectRef, readOnly: true, connected: true, inspection }));
// Before its first migration, staging must be empty; afterwards its own history explains its contents.
if (!inspection.migrationHistoryPresent &&
	(inspection.publicTables !== 0 || inspection.privateTables !== 0 || inspection.authUsers !== 0 || inspection.storageBuckets !== 0))
	throw new Error('The candidate staging contains data without a migration history. No writes were attempted.');

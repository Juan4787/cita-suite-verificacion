import { spawnSync } from 'node:child_process';

// Read-only preparation. Never infer a target from .env or a CLI link.
const projectRef = 'ikaudqoilclfnztkxubz';
const input = process.env.CITA_STAGING_DATABASE_URL;
let url;
try { url = new URL(input); } catch { throw new Error('The explicit staging connection is invalid. No connection was attempted.'); }
if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
	url.hostname !== 'aws-1-us-west-2.pooler.supabase.com' ||
	decodeURIComponent(url.username) !== `postgres.${projectRef}` ||
	url.port !== '5432' || url.pathname !== '/postgres' || !url.password)
	throw new Error('The connection does not match the authorized staging project. No connection was attempted.');
const sql = `select json_build_object(
 'database',current_database(),'user',current_user,'version',version(),
 'publicTables',(select count(*) from pg_tables where schemaname='public'),
 'privateTables',(select count(*) from pg_tables where schemaname='private'),
 'authUsers',(select count(*) from auth.users),
 'storageBuckets',(select count(*) from storage.buckets),
 'migrationHistoryPresent',to_regclass('supabase_migrations.schema_migrations') is not null);`;
const result = spawnSync('psql', ['-X', '-h', url.hostname, '-p', url.port, '-U', decodeURIComponent(url.username),
	'-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', sql], {
	encoding: 'utf8', timeout: 25_000, maxBuffer: 64 * 1024,
	env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '5',
		PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=10000 -c application_name=cita_suite_staging_audit' }
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
if (inspection.publicTables !== 0 || inspection.privateTables !== 0 || inspection.authUsers !== 0 || inspection.storageBuckets !== 0)
	throw new Error('The candidate staging contains data. No writes were attempted.');

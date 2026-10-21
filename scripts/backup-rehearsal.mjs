import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGING_PROJECT_REF, psqlDiagnostics, stagingConnection, stagingPsql } from './lib/staging-database.mjs';
import { copyRowCounts, countMismatches, objectMismatches } from './lib/backup-verification.mjs';

// Rehearses, on staging and an isolated database, the backup and restore Supabase documents
// for Free projects (no managed daily backups): the pinned CLI dumps roles, schema and data,
// psql restores them into an empty disposable Supabase Postgres as the documentation does,
// and the restore must hold every row of the dump and the same migration history. Stored
// files are not in the dump: each one is downloaded and checked against the size the
// database records. The receipt holds counts and fingerprints, never rows or files.
const root = fileURLToPath(new URL('../', import.meta.url));
const url = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const serviceKey = process.env.CITA_STAGING_SERVICE_ROLE_KEY ?? '';
if (!/^[\w.-]{20,}$/.test(serviceKey)) throw new Error('The staging service key is required to back up stored files.');
const storageOrigin = `https://${STAGING_PROJECT_REF}.supabase.co`;
const image = 'public.ecr.aws/supabase/postgres:17.6.1.166';
const container = 'cita-backup-rehearsal-' + randomBytes(6).toString('hex');
const work = mkdtempSync(join(tmpdir(), 'cita-backup-rehearsal-'));
const receipt = { projectRef: STAGING_PROJECT_REF, image, startedAt: new Date().toISOString(), ok: false };
// No output of a failed command may carry the connection: it is removed before any message.
const redact = (text) => String(text ?? '').replaceAll(url.href, '[staging-url]').replaceAll(decodeURIComponent(url.password), '[secret]').slice(-4000);
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function run(cmd, args, options = {}) {
	const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2, timeout: 900_000, ...options });
	if (result.error || result.status !== 0)
		throw new Error(`${cmd} ${args[0]} failed.\n${redact(result.error?.message ?? result.stderr)}`);
	return result.stdout;
}
const docker = (args, input) => run('docker', args, { input });
// The disposable database is reached through its own socket, as the SQL suites do.
const restoredSql = (sql) => docker(['exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], sql).trim();
function stagingJson(sql) {
	const result = stagingPsql(url, ['-Atq', '-f', '-'], {
		input: `begin transaction read only;\n${sql}\ncommit;\n`,
		options: '-c statement_timeout=60000 -c application_name=cita_suite_backup_rehearsal'
	});
	if (result.error || result.status !== 0) throw new Error('Staging query failed.\n' + psqlDiagnostics(result.stderr));
	return JSON.parse(result.stdout.split('\n').filter((line) => line && line !== 'BEGIN' && line !== 'COMMIT').join('\n'));
}

try {
	// 1. Backup, with the commands of the Supabase guide.
	const files = { roles: join(work, 'roles.sql'), schema: join(work, 'schema.sql'), data: join(work, 'data.sql') };
	const dumpStarted = performance.now();
	const dump = (args) => run('pnpm', ['exec', 'supabase', 'db', 'dump', '--db-url', url.href, ...args]);
	dump(['-f', files.roles, '--role-only']);
	dump(['-f', files.schema]);
	dump(['-f', files.data, '--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes']);
	receipt.dumpMs = Math.round(performance.now() - dumpStarted);
	receipt.files = Object.fromEntries(Object.entries(files).map(([name, path]) => [name, { bytes: statSync(path).size, sha256: sha256(path) }]));
	const dumped = copyRowCounts(readFileSync(files.data, 'utf8'));
	receipt.tables = Object.keys(dumped).length;
	receipt.rows = Object.values(dumped).reduce((sum, count) => sum + count, 0);
	if (!receipt.tables) throw new Error('The data dump holds no table.');
	const source = stagingJson(`select json_build_object(
		'migrations', (select coalesce(json_agg(version order by version), '[]'::json) from supabase_migrations.schema_migrations),
		'objects', (select coalesce(json_agg(json_build_object('bucket', bucket_id, 'name', name, 'size', (metadata->>'size')::bigint) order by bucket_id, name), '[]'::json) from storage.objects)
	)::text;`);

	// 2. Restore into an empty Supabase Postgres of the hosted version, without network.
	docker(['image', 'inspect', image]);
	docker(['run', '-d', '--name', container, '--label', 'com.cita-suite.backup-rehearsal=true', '--network', 'none',
		'-e', 'POSTGRES_PASSWORD=cita-disposable-test-only', image, 'postgres', '-c', 'cron.database_name=postgres']);
	let ready = false;
	for (let attempt = 0; attempt < 120 && !ready; attempt++) {
		ready = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'supabase_admin'], { encoding: 'utf8' }).status === 0;
		if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
	}
	if (!ready) throw new Error('The disposable database did not start.');
	for (const [name, path] of Object.entries(files)) docker(['cp', path, `${container}:/tmp/${name}.sql`]);
	const restoreStarted = performance.now();
	docker(['exec', '-e', 'PGPASSWORD=cita-disposable-test-only', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-q',
		'-f', '/tmp/roles.sql', '-f', '/tmp/schema.sql', '-c', 'SET session_replication_role = replica', '-f', '/tmp/data.sql']);
	receipt.restoreMs = Math.round(performance.now() - restoreStarted);

	// 3. The restore holds every row of the dump and the same migration history.
	const literal = (text) => `'${text.replaceAll("'", "''")}'`;
	const relation = (table) => table.split('.').map((part) => `"${part.replaceAll('"', '""')}"`).join('.');
	const restored = JSON.parse(restoredSql(`select json_build_object(${Object.keys(dumped)
		.map((table) => `${literal(table)}, (select count(*) from ${relation(table)})`).join(', ')})::text;`));
	receipt.rowMismatches = countMismatches(dumped, restored);
	// The CLI history may stay out of the dump with the platform schemas. The backup keeps the
	// list read from the source, so a restore can record it again; when present it must match.
	const restoredMigrations = JSON.parse(restoredSql(`select case when to_regclass('supabase_migrations.schema_migrations') is null then 'null'
		else (select coalesce(json_agg(version order by version), '[]'::json)::text from supabase_migrations.schema_migrations) end;`));
	receipt.migrations = { source: source.migrations.length, inDump: restoredMigrations !== null,
		same: restoredMigrations === null || JSON.stringify(restoredMigrations) === JSON.stringify(source.migrations) };
	receipt.migrationHistory = source.migrations;

	// 4. Stored files: every object the database records downloads whole.
	const downloads = new Map();
	let objectBytes = 0;
	for (const { bucket, name } of source.objects) {
		const path = name.split('/').map(encodeURIComponent).join('/');
		const response = await fetch(`${storageOrigin}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${path}`, {
			headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey }, redirect: 'error', signal: AbortSignal.timeout(30_000)
		});
		if (!response.ok) continue;
		const body = Buffer.from(await response.arrayBuffer());
		objectBytes += body.length;
		downloads.set(`${bucket}/${name}`, { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
	}
	receipt.objects = { recorded: source.objects.length, downloaded: downloads.size, bytes: objectBytes };
	receipt.objectMismatches = objectMismatches(source.objects, downloads);

	receipt.ok = receipt.rowMismatches.length === 0 && receipt.migrations.same && receipt.objectMismatches.length === 0;
	if (!receipt.ok) process.exitCode = 1;
} catch (error) {
	receipt.error = redact(error.message);
	process.exitCode = 1;
} finally {
	// Only the container this run created, identified by its name and label.
	spawnSync('docker', ['rm', '-f', '--volumes', container], { encoding: 'utf8' });
	rmSync(work, { recursive: true, force: true });
	receipt.finishedAt = new Date().toISOString();
	mkdirSync(join(root, '.verification'), { recursive: true });
	writeFileSync(join(root, '.verification/backup-rehearsal.json'), JSON.stringify(receipt, null, 2) + '\n');
	console.log(JSON.stringify(receipt, null, 2));
}

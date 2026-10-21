import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGING_PROJECT_REF, psqlDiagnostics, stagingConnection, stagingPsql } from './lib/staging-database.mjs';
import { copyRowCounts, countMismatches, objectMismatches } from './lib/backup-verification.mjs';

// Rehearses, on staging and an isolated target, the backup and restore Supabase documents for
// Free projects (no managed daily backups). The pinned CLI dumps roles, schema and data; psql
// restores them as the documentation does into a new project: the CLI's local stack on this
// runner, whose own Auth, Storage and Realtime create their schemas as a hosted project's
// services do. The restore must hold every row of the dump and the same migration history.
// Stored files are not in the dump: each one is downloaded, uploaded to the new project and
// read back with the same fingerprint. The receipt holds counts and fingerprints, never data.
const root = fileURLToPath(new URL('../', import.meta.url));
const url = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const serviceKey = process.env.CITA_STAGING_SERVICE_ROLE_KEY ?? '';
if (!/^[\w.-]{20,}$/.test(serviceKey)) throw new Error('The staging service key is required to back up stored files.');
const storageOrigin = `https://${STAGING_PROJECT_REF}.supabase.co`;
const work = mkdtempSync(join(tmpdir(), 'cita-backup-rehearsal-'));
const project = join(work, 'project');
const projectId = 'cita-backup-rehearsal-' + randomBytes(4).toString('hex');
const receipt = { projectRef: STAGING_PROJECT_REF, target: 'Supabase CLI local stack (pinned CLI)', startedAt: new Date().toISOString(), ok: false };
let started = false;
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
const cli = (args) => run('pnpm', ['exec', 'supabase', ...args, '--workdir', project]);
// The new project's database, reached inside its own container as the CLI names it.
const database = `supabase_db_${projectId}`;
const restoredSql = (sql) => docker(['exec', '-i', '-e', 'PGPASSWORD=postgres', database, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], sql).trim();
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

	// 2. Restore into a new project: the CLI's stack in an empty directory, without migrations.
	mkdirSync(join(project, 'supabase'), { recursive: true });
	writeFileSync(join(project, 'supabase/config.toml'), [`project_id = "${projectId}"`, '',
		'[api]', 'enabled = true', 'port = 56421', '', '[db]', 'port = 56422', 'major_version = 17', '',
		'[studio]', 'enabled = false', '', '[storage]', 'enabled = true', '', '[analytics]', 'enabled = false', '',
		'[inbucket]', 'enabled = false', '', '[auth]', 'enabled = true', '', '[edge_runtime]', 'enabled = false', ''].join('\n'));
	started = true;
	cli(['start']);
	const local = JSON.parse(cli(['status', '-o', 'json']));
	const localApi = local.API_URL;
	const localKey = local.SERVICE_ROLE_KEY ?? local.SECRET_KEY;
	if (!localApi || !localKey) throw new Error('The new project did not report its API and service key.');
	// A new project defines the platform's roles itself, and their settings are the platform's.
	// A role statement is skipped when it names only platform roles: those the new project
	// already has, and the reserved supabase_* and pg_* roles (the dump creates Realtime's
	// supabase_realtime_admin, which the CLI does not reserve). Statements about the project's
	// own roles stay. The schema gets the fix the guide lists for supabase_admin ownership.
	const existingRoles = new Set(JSON.parse(restoredSql("select json_agg(rolname)::text from pg_roles;")));
	const skippedRoles = new Set();
	const rolesLines = readFileSync(files.roles, 'utf8').split('\n').map((line) => {
		// The roles a statement names: CREATE or ALTER ROLE "x" …, or GRANT "a" TO "b".
		const identifier = '"((?:[^"]|"")+)"';
		const altered = new RegExp(`^(?:CREATE|ALTER) ROLE ${identifier}`).exec(line);
		const granted = new RegExp(`^GRANT ${identifier} TO ${identifier}(?: WITH [A-Z ]+? OPTION)?(?: GRANTED BY ${identifier})?`).exec(line);
		const match = altered ?? granted;
		if (!match) return line;
		const named = match.slice(1).filter(Boolean).map((role) => role.replaceAll('""', '"'));
		const platform = (role) => existingRoles.has(role) || /^(supabase_|pg_)/.test(role);
		if (!named.length || !named.every(platform)) return line;
		named.forEach((role) => skippedRoles.add(role));
		return '-- ' + line;
	});
	writeFileSync(files.roles, rolesLines.join('\n'));
	const schemaLines = readFileSync(files.schema, 'utf8').split('\n');
	const ownershipFixes = schemaLines.filter((line) => /^ALTER .* OWNER TO "supabase_admin";$/.test(line)).length;
	writeFileSync(files.schema, schemaLines.map((line) => (/^ALTER .* OWNER TO "supabase_admin";$/.test(line) ? '-- ' + line : line)).join('\n'));
	receipt.restoreFixes = {
		platformRoleStatements: rolesLines.filter((line) => /^-- (CREATE ROLE|ALTER ROLE|GRANT) /.test(line)).length,
		platformRoles: [...skippedRoles].sort(),
		ownRoleStatements: rolesLines.filter((line) => /^(CREATE ROLE|ALTER ROLE|GRANT) /.test(line)).length,
		supabaseAdminOwnership: ownershipFixes
	};
	for (const [name, path] of Object.entries(files)) docker(['cp', path, `${database}:/tmp/${name}.sql`]);
	const restoreStarted = performance.now();
	docker(['exec', '-e', 'PGPASSWORD=postgres', database, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-q',
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

	// 4. Stored files: every object the database records downloads whole, uploads to the new
	// project as the guide's script does and reads back with the same fingerprint.
	const downloads = new Map();
	const restoredFiles = new Map();
	let objectBytes = 0;
	const objectPath = (bucket, name) => `${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`;
	const storage = async (origin, key, path, init = {}) => {
		const response = await fetch(`${origin}/storage/v1/object/${path}`, {
			...init, headers: { Authorization: `Bearer ${key}`, apikey: key, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(30_000)
		});
		if (!response.ok) throw new Error(`Storage ${init.method ?? 'GET'} answered ${response.status}.`);
		return response;
	};
	for (const { bucket, name } of source.objects) {
		const response = await storage(storageOrigin, serviceKey, `authenticated/${objectPath(bucket, name)}`).catch(() => null);
		if (!response) continue;
		const body = Buffer.from(await response.arrayBuffer());
		const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
		objectBytes += body.length;
		downloads.set(`${bucket}/${name}`, { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
		await storage(localApi, localKey, objectPath(bucket, name), { method: 'POST', body, headers: { 'content-type': contentType, 'x-upsert': 'true' } });
		const restoredBody = Buffer.from(await (await storage(localApi, localKey, `authenticated/${objectPath(bucket, name)}`)).arrayBuffer());
		restoredFiles.set(`${bucket}/${name}`, { bytes: restoredBody.length, sha256: createHash('sha256').update(restoredBody).digest('hex') });
	}
	receipt.objects = { recorded: source.objects.length, downloaded: downloads.size, restored: restoredFiles.size, bytes: objectBytes };
	receipt.objectMismatches = objectMismatches(source.objects, downloads);
	receipt.restoredFileMismatches = [...downloads].filter(([key, file]) => restoredFiles.get(key)?.sha256 !== file.sha256).map(([key]) => key);

	receipt.ok = receipt.rowMismatches.length === 0 && receipt.migrations.same && receipt.objectMismatches.length === 0
		&& receipt.restoredFileMismatches.length === 0;
	if (!receipt.ok) process.exitCode = 1;
} catch (error) {
	receipt.error = redact(error.message);
	process.exitCode = 1;
} finally {
	// Only the new project this run created, with its volumes.
	if (started) spawnSync('pnpm', ['exec', 'supabase', 'stop', '--no-backup', '--workdir', project], { cwd: root, encoding: 'utf8', timeout: 300_000 });
	rmSync(work, { recursive: true, force: true });
	receipt.finishedAt = new Date().toISOString();
	mkdirSync(join(root, '.verification'), { recursive: true });
	writeFileSync(join(root, '.verification/backup-rehearsal.json'), JSON.stringify(receipt, null, 2) + '\n');
	console.log(JSON.stringify(receipt, null, 2));
}

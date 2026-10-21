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
// A synthetic stored file in a bucket of its own, so the file path of the backup is exercised
// whether or not staging holds clinical files. It is removed at the end, whatever happens.
const rehearsalBucket = 'cita-backup-rehearsal';
const rehearsalObject = `rehearsal/${projectId}.txt`;
let rehearsalFileCreated = false;
const stagingStorage = (path, init = {}) => fetch(`${storageOrigin}/storage/v1/${path}`, {
	...init, headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(30_000)
});
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
// Policies and triggers the migrations add to the schemas the platform manages (Storage's
// objects, Realtime's messages): a schema dump that leaves those schemas out would restore the
// clinical files without their row security.
const managedObjectsSql = `select json_build_object(
	'policies', (select coalesce(json_agg(schemaname || '.' || tablename || ':' || policyname order by 1), '[]'::json)
		from pg_policies where schemaname in ('storage', 'realtime', 'auth')),
	'triggers', (select coalesce(json_agg(n.nspname || '.' || c.relname || ':' || t.tgname order by 1), '[]'::json)
		from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
		join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
		where not t.tgisinternal and n.nspname in ('storage', 'realtime', 'auth') and fn.nspname in ('public', 'private'))
)::text;`;
// The schema dump leaves the platform's schemas out, and with them the policies, triggers and
// Realtime publication entries the migrations add there. The backup keeps them in a fourth
// file, read from the source's catalog, which the restore applies last.
const managedDefinitionsSql = `select json_build_object('statements', coalesce(json_agg(statement order by statement), '[]'::json))::text from (
	select format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;', p.polname, n.nspname, c.relname,
		case when p.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,
		case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
		case when p.polroles = '{0}'::oid[] then 'PUBLIC' else (select string_agg(quote_ident(r.rolname), ', ' order by r.rolname) from pg_roles r where r.oid = any(p.polroles)) end,
		coalesce(' USING (' || pg_get_expr(p.polqual, p.polrelid) || ')', ''),
		coalesce(' WITH CHECK (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')', '')) as statement
	from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
	where n.nspname in ('storage', 'realtime', 'auth')
	union all
	select pg_get_triggerdef(t.oid) || ';'
	from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
	join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
	where not t.tgisinternal and n.nspname in ('storage', 'realtime', 'auth') and fn.nspname in ('public', 'private')
	union all
	select format('ALTER PUBLICATION %I ADD TABLE %I.%I;', pubname, schemaname, tablename)
	from pg_publication_tables where pubname = 'supabase_realtime' and schemaname in ('public', 'private')
) definitions;`;
function stagingJson(sql) {
	const result = stagingPsql(url, ['-Atq', '-f', '-'], {
		input: `begin transaction read only;\n${sql}\ncommit;\n`,
		options: '-c statement_timeout=60000 -c application_name=cita_suite_backup_rehearsal'
	});
	if (result.error || result.status !== 0) throw new Error('Staging query failed.\n' + psqlDiagnostics(result.stderr));
	return JSON.parse(result.stdout.split('\n').filter((line) => line && line !== 'BEGIN' && line !== 'COMMIT').join('\n'));
}

try {
	const bucket = await stagingStorage('bucket', { method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: rehearsalBucket, name: rehearsalBucket, public: false }) });
	if (!bucket.ok && bucket.status !== 409 && bucket.status !== 400) throw new Error(`The rehearsal bucket could not be created (${bucket.status}).`);
	const upload = await stagingStorage(`object/${rehearsalBucket}/${rehearsalObject}`, { method: 'POST',
		headers: { 'content-type': 'text/plain' }, body: `Archivo sintético del ensayo de respaldo ${projectId}.\n`.repeat(32) });
	if (!upload.ok) throw new Error(`The rehearsal file could not be stored (${upload.status}).`);
	rehearsalFileCreated = true;

	// 1. Backup, with the commands of the Supabase guide.
	const files = { roles: join(work, 'roles.sql'), schema: join(work, 'schema.sql'), data: join(work, 'data.sql'), managed: join(work, 'managed.sql') };
	const dumpStarted = performance.now();
	const dump = (args) => run('pnpm', ['exec', 'supabase', 'db', 'dump', '--db-url', url.href, ...args]);
	dump(['-f', files.roles, '--role-only']);
	dump(['-f', files.schema]);
	dump(['-f', files.data, '--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes']);
	writeFileSync(files.managed, stagingJson(managedDefinitionsSql).statements.join('\n') + '\n');
	// The CLI's migration history stays out of the dump with the platform schemas: the backup
	// records it in a file of its own, which the restore applies as the CLI keeps it.
	const history = stagingJson(`select coalesce(json_agg(json_build_array(version, name) order by version), '[]'::json)::text
		from supabase_migrations.schema_migrations;`);
	files.history = join(work, 'history.sql');
	const literalValue = (text) => (text === null ? 'null' : `'${String(text).replaceAll("'", "''")}'`);
	writeFileSync(files.history, ['create schema if not exists supabase_migrations;',
		'create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);',
		...history.map(([version, name]) => `insert into supabase_migrations.schema_migrations (version, name) values (${literalValue(version)}, ${literalValue(name)});`)
	].join('\n') + '\n');
	receipt.dumpMs = Math.round(performance.now() - dumpStarted);
	receipt.files = Object.fromEntries(Object.entries(files).map(([name, path]) => [name, { bytes: statSync(path).size, sha256: sha256(path) }]));
	const dumped = copyRowCounts(readFileSync(files.data, 'utf8'));
	receipt.tables = Object.keys(dumped).length;
	receipt.rows = Object.values(dumped).reduce((sum, count) => sum + count, 0);
	if (!receipt.tables) throw new Error('The data dump holds no table.');
	const managedSource = stagingJson(managedObjectsSql);
	const source = stagingJson(`select json_build_object(
		'migrations', (select coalesce(json_agg(json_build_array(version, name) order by version), '[]'::json) from supabase_migrations.schema_migrations),
		'objects', (select coalesce(json_agg(json_build_object('bucket', bucket_id, 'name', name, 'size', (metadata->>'size')::bigint) order by bucket_id, name), '[]'::json) from storage.objects)
	)::text;`);

	// 2. Restore into a new project: the CLI's stack in an empty directory, without migrations.
	mkdirSync(join(project, 'supabase'), { recursive: true });
	writeFileSync(join(project, 'supabase/config.toml'), [`project_id = "${projectId}"`, '',
		'[api]', 'enabled = true', 'port = 56421', '', '[db]', 'port = 56422', 'major_version = 17', '',
		'[studio]', 'enabled = false', '', '[storage]', 'enabled = true', '', '[analytics]', 'enabled = false', '',
		'[inbucket]', 'enabled = false', '', '[auth]', 'enabled = true', '', '[edge_runtime]', 'enabled = false', ''].join('\n'));
	// The hosted services are ahead of the CLI's pinned ones, and the data dump carries their
	// tables (Auth's MFA recovery codes, for one). The CLI matches a remote project the way
	// `supabase link` does, through its version files: the new project runs the Auth and
	// Storage versions that staging serves.
	const health = await (await fetch(`${storageOrigin}/auth/v1/health`, { headers: { apikey: serviceKey }, signal: AbortSignal.timeout(10_000) })).json();
	const storageVersion = (await (await fetch(`${storageOrigin}/storage/v1/version`, { signal: AbortSignal.timeout(10_000) })).text()).trim();
	receipt.serviceVersions = { gotrue: String(health.version ?? ''), storage: storageVersion.startsWith('v') ? storageVersion : 'v' + storageVersion };
	if (!Object.values(receipt.serviceVersions).every((version) => /^v\d+\.\d+\.\d+$/.test(version)))
		throw new Error('Staging did not report its Auth and Storage versions.');
	mkdirSync(join(project, 'supabase/.temp'), { recursive: true });
	writeFileSync(join(project, 'supabase/.temp/gotrue-version'), receipt.serviceVersions.gotrue);
	writeFileSync(join(project, 'supabase/.temp/storage-version'), receipt.serviceVersions.storage);
	started = true;
	cli(['start']);
	const local = JSON.parse(cli(['status', '-o', 'json']));
	const localApi = local.API_URL;
	const localKey = local.SERVICE_ROLE_KEY ?? local.SECRET_KEY;
	if (!localApi || !localKey) throw new Error('The new project did not report its API and service key.');
	// A new project defines the platform's roles itself. As the CLI does for the roles it
	// reserves, a statement that creates a platform role, grants it anything, or alters one
	// is skipped; the settings the CLI restores on purpose (statement_timeout, pgrst.*) stay.
	// Platform roles: those the new project already has, and the reserved supabase_* and pg_*
	// ones (the dump grants Realtime's supabase_realtime_admin a parameter the CLI does not
	// reserve). The schema gets the fix the guide lists for supabase_admin ownership.
	const existingRoles = new Set(JSON.parse(restoredSql("select json_agg(rolname)::text from pg_roles;")));
	const platform = (role) => existingRoles.has(role) || /^(supabase_|pg_)/.test(role);
	const restorableSetting = /^ALTER ROLE "(?:[^"]|"")+" SET "(statement_timeout|pgrst\.[^"]+)" /;
	const skippedRoles = new Set();
	const rolesLines = readFileSync(files.roles, 'utf8').split('\n').map((line) => {
		const created = /^CREATE ROLE "((?:[^"]|"")+)"/.exec(line)?.[1];
		const grantee = /^GRANT .+ TO "((?:[^"]|"")+)"/.exec(line)?.[1];
		const altered = restorableSetting.test(line) ? null : /^ALTER ROLE "((?:[^"]|"")+)"/.exec(line)?.[1];
		const role = (created ?? grantee ?? altered)?.replaceAll('""', '"');
		if (!role || !platform(role)) return line;
		skippedRoles.add(role);
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
		// The dump has no passwords (--no-role-passwords); text values are hidden anyway.
		roleStatements: rolesLines.filter((line) => /^(-- )?(CREATE ROLE|ALTER ROLE|GRANT) /.test(line)).map((line) => line.replace(/'(?:[^']|'')*'/g, "'…'")),
		supabaseAdminOwnership: ownershipFixes
	};
	for (const [name, path] of Object.entries(files)) docker(['cp', path, `${database}:/tmp/${name}.sql`]);
	const restoreStarted = performance.now();
	const restore = spawnSync('docker', ['exec', '-e', 'PGPASSWORD=postgres', database, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-q',
		'-f', '/tmp/roles.sql', '-f', '/tmp/schema.sql', '-c', 'SET session_replication_role = replica', '-f', '/tmp/data.sql',
		'-c', 'SET session_replication_role = origin', '-f', '/tmp/managed.sql', '-f', '/tmp/history.sql'],
		{ encoding: 'utf8', maxBuffer: 256 * 1024 ** 2, timeout: 900_000 });
	// The error first, then each distinct warning once: grants on extension functions the
	// platform owns print one warning each.
	receipt.restoreDiagnostics = psqlDiagnostics(restore.stderr).slice(0, 3000);
	if (restore.error || restore.status !== 0) throw new Error('The restore failed.\n' + redact(receipt.restoreDiagnostics));
	receipt.restoreMs = Math.round(performance.now() - restoreStarted);

	// 3. The restore holds every row of the dump and the same migration history.
	const literal = (text) => `'${text.replaceAll("'", "''")}'`;
	const relation = (table) => table.split('.').map((part) => `"${part.replaceAll('"', '""')}"`).join('.');
	// One row per table: a function takes at most 100 arguments, so no json_build_object.
	const restored = JSON.parse(restoredSql(`select json_object_agg(name, rows)::text from (${Object.keys(dumped)
		.map((table) => `select ${literal(table)} as name, (select count(*) from ${relation(table)}) as rows`).join(' union all ')}) counts;`));
	receipt.rowMismatches = countMismatches(dumped, restored);
	// The CLI history may stay out of the dump with the platform schemas. The backup keeps the
	// list read from the source, so a restore can record it again; when present it must match.
	const restoredMigrations = JSON.parse(restoredSql(
		"select coalesce(json_agg(json_build_array(version, name) order by version), '[]'::json)::text from supabase_migrations.schema_migrations;"));
	receipt.migrations = { source: source.migrations.length, restored: restoredMigrations.length,
		same: JSON.stringify(restoredMigrations) === JSON.stringify(source.migrations) };
	const managedRestored = JSON.parse(restoredSql(managedObjectsSql));
	receipt.managedSchemaObjects = {
		source: { policies: managedSource.policies.length, triggers: managedSource.triggers.length },
		missing: [...managedSource.policies, ...managedSource.triggers].filter((name) => ![...managedRestored.policies, ...managedRestored.triggers].includes(name))
	};

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
		&& receipt.restoredFileMismatches.length === 0 && receipt.managedSchemaObjects.missing.length === 0;
	if (!receipt.ok) process.exitCode = 1;
} catch (error) {
	receipt.error = redact(error.message);
	process.exitCode = 1;
} finally {
	if (rehearsalFileCreated) {
		const removed = await stagingStorage(`object/${rehearsalBucket}`, { method: 'DELETE', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ prefixes: [rehearsalObject] }) }).catch(() => null);
		const bucketRemoved = await stagingStorage(`bucket/${rehearsalBucket}`, { method: 'DELETE' }).catch(() => null);
		receipt.rehearsalFileRemoved = Boolean(removed?.ok) && Boolean(bucketRemoved?.ok);
		if (!receipt.rehearsalFileRemoved) { receipt.ok = false; process.exitCode = 1; }
	}
	// Only the new project this run created, with its volumes.
	if (started) spawnSync('pnpm', ['exec', 'supabase', 'stop', '--no-backup', '--workdir', project], { cwd: root, encoding: 'utf8', timeout: 300_000 });
	rmSync(work, { recursive: true, force: true });
	receipt.finishedAt = new Date().toISOString();
	mkdirSync(join(root, '.verification'), { recursive: true });
	writeFileSync(join(root, '.verification/backup-rehearsal.json'), JSON.stringify(receipt, null, 2) + '\n');
	console.log(JSON.stringify(receipt, null, 2));
}

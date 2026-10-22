import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGING_PROJECT_REF, psqlDiagnostics, stagingConnection, stagingPsql } from './lib/staging-database.mjs';
import { countMismatches, objectMismatches } from './lib/backup-verification.mjs';
import { MANAGED_OBJECTS_SQL, createSupabaseBackup, restoreArguments, restoreSupabaseBackup } from './lib/supabase-backup.mjs';
import { createBackupStorageProbe } from './lib/backup-storage-probe.mjs';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';

// Rehearses the backup and its restore (lib/supabase-backup.mjs) on staging and an isolated
// target: the backup is written to disk, then restored from those files into a new project,
// the CLI's local stack on this runner, whose own Auth, Storage and Realtime create their
// schemas as a hosted project's services do. The restore must hold every row of the backup,
// its migration history, the objects the migrations add to the platform's schemas, and every
// stored file with the same fingerprint. The receipt holds counts and fingerprints, never data.
const root = fileURLToPath(new URL('../', import.meta.url));
assertHostedIntegrationResources();
const url = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const serviceKey = process.env.CITA_STAGING_SERVICE_ROLE_KEY ?? '';
if (!/^[\w.-]{20,}$/.test(serviceKey)) throw new Error('The staging service key is required to back up stored files.');
const apiOrigin = `https://${STAGING_PROJECT_REF}.supabase.co`;
const work = mkdtempSync(join(tmpdir(), 'cita-backup-rehearsal-'));
const backup = join(work, 'backup');
const project = join(work, 'project');
const projectId = 'cita-backup-rehearsal-' + randomBytes(4).toString('hex');
const receipt = { projectRef: STAGING_PROJECT_REF, target: 'Supabase CLI local stack (pinned CLI)', startedAt: new Date().toISOString(), ok: false };
let started = false;
// A synthetic stored file in a bucket of its own, so the file path of the backup is exercised
// whether or not staging holds clinical files. It is removed at the end, whatever happens.
let rehearsalProbe;
receipt.rehearsalBucket = projectId;
// No output of a failed command may carry the connection: it is removed before any message.
const redact = (text) => String(text ?? '').replaceAll(url.href, '[staging-url]').replaceAll(decodeURIComponent(url.password), '[secret]').slice(-4000);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

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
// A transient answer (network, 429, 5xx) is retried twice with a growing pause; any other is a failure.
async function storage(origin, key, path, init = {}) {
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(`${origin}/storage/v1/${path}`, {
			...init, headers: { Authorization: `Bearer ${key}`, apikey: key, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(30_000)
		}).catch((error) => ({ ok: false, status: 0, error }));
		if (response.ok) return response;
		if (attempt >= 3 || (response.status !== 0 && response.status !== 429 && response.status < 500))
			throw new Error(`Storage ${init.method ?? 'GET'} answered ${response.status || 'without response'}.`);
		await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
	}
}
const objectPath = (bucket, name) => `${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`;

try {
	// Never adopt an existing bucket. Once its creation is confirmed, cleanup owns
	// both the bucket and exact object, even if the upload answer is lost.
	rehearsalProbe = await createBackupStorageProbe((path, init) => storage(apiOrigin, serviceKey, path, init), projectId);
	await rehearsalProbe.upload(`Archivo sintético del ensayo de respaldo ${projectId}.\n`.repeat(32));

	// 1. Backup to disk.
	const manifest = await createSupabaseBackup({
		directory: backup,
		source: { projectRef: STAGING_PROJECT_REF },
		dump: (args) => run('pnpm', ['exec', 'supabase', 'db', 'dump', '--db-url', url.href, ...args]),
		readJson: stagingJson,
		storageGet: async (bucketId, name) => {
			const response = await storage(apiOrigin, serviceKey, `object/authenticated/${objectPath(bucketId, name)}`);
			return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
		}
	});
	receipt.dumpMs = manifest.dumpMs;
	receipt.files = manifest.files;
	receipt.tables = Object.keys(manifest.rows).length;
	receipt.rows = Object.values(manifest.rows).reduce((sum, count) => sum + count, 0);
	receipt.objectFailures = manifest.objectFailures;
	if (!receipt.tables) throw new Error('The data dump holds no table.');

	// 2. A new project: the CLI's stack in an empty directory, without migrations, running the
	// Auth and Storage versions staging serves (the hosted services are ahead of the CLI's
	// pinned ones, and the data carries their tables). The CLI matches a remote project that
	// way, through the version files `supabase link` writes.
	mkdirSync(join(project, 'supabase/.temp'), { recursive: true });
	writeFileSync(join(project, 'supabase/config.toml'), [`project_id = "${projectId}"`, '',
		'[api]', 'enabled = true', 'port = 56421', '', '[db]', 'port = 56422', 'major_version = 17', '',
		'[studio]', 'enabled = false', '', '[storage]', 'enabled = true', '', '[analytics]', 'enabled = false', '',
		'[inbucket]', 'enabled = false', '', '[auth]', 'enabled = true', '', '[edge_runtime]', 'enabled = false', ''].join('\n'));
	const health = await (await fetch(`${apiOrigin}/auth/v1/health`, { headers: { apikey: serviceKey }, signal: AbortSignal.timeout(10_000) })).json();
	const storageVersion = (await (await fetch(`${apiOrigin}/storage/v1/version`, { signal: AbortSignal.timeout(10_000) })).text()).trim();
	receipt.serviceVersions = { gotrue: String(health.version ?? ''), storage: storageVersion.startsWith('v') ? storageVersion : 'v' + storageVersion };
	if (!Object.values(receipt.serviceVersions).every((version) => /^v\d+\.\d+\.\d+$/.test(version)))
		throw new Error('Staging did not report its Auth and Storage versions.');
	writeFileSync(join(project, 'supabase/.temp/gotrue-version'), receipt.serviceVersions.gotrue);
	writeFileSync(join(project, 'supabase/.temp/storage-version'), receipt.serviceVersions.storage);
	started = true;
	cli(['start']);
	const local = JSON.parse(cli(['status', '-o', 'json']));
	const localApi = local.API_URL;
	const localKey = local.SERVICE_ROLE_KEY ?? local.SECRET_KEY;
	if (!localApi || !localKey) throw new Error('The new project did not report its API and service key.');

	// 3. Restore from the files on disk.
	const restore = await restoreSupabaseBackup({
		directory: backup,
		existingRoles: new Set(JSON.parse(restoredSql('select json_agg(rolname)::text from pg_roles;'))),
		psql: (paths) => {
			const inside = {};
			for (const [name, path] of Object.entries(paths)) {
				inside[name] = `/tmp/${name}.sql`;
				docker(['cp', path, `${database}:${inside[name]}`]);
			}
			const result = spawnSync('docker', ['exec', '-e', 'PGPASSWORD=postgres', database, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', ...restoreArguments(inside)],
				{ encoding: 'utf8', maxBuffer: 256 * 1024 ** 2, timeout: 900_000 });
			// The error first, then each distinct warning once: grants on extension functions
			// the platform owns print one warning each.
			receipt.restoreDiagnostics = psqlDiagnostics(result.stderr).slice(0, 3000);
			if (result.error || result.status !== 0) throw new Error('The restore failed.\n' + redact(receipt.restoreDiagnostics));
		},
		storagePut: (object, body) => storage(localApi, localKey, `object/${objectPath(object.bucket, object.name)}`,
			{ method: 'POST', body, headers: { 'content-type': object.contentType, 'x-upsert': 'true' } })
	});
	receipt.restoreMs = restore.restoreMs;
	receipt.restoreFixes = restore.fixes;

	// 4. Everything the backup holds is back.
	const quoted = (text) => `'${text.replaceAll("'", "''")}'`;
	const relation = (table) => table.split('.').map((part) => `"${part.replaceAll('"', '""')}"`).join('.');
	// One row per table: a function takes at most 100 arguments, so no json_build_object.
	const restoredRows = JSON.parse(restoredSql(`select json_object_agg(name, rows)::text from (${Object.keys(manifest.rows)
		.map((table) => `select ${quoted(table)} as name, (select count(*) from ${relation(table)}) as rows`).join(' union all ')}) counts;`));
	receipt.rowMismatches = countMismatches(manifest.rows, restoredRows);
	const restoredHistory = JSON.parse(restoredSql(
		"select coalesce(json_agg(json_build_array(version, name) order by version), '[]'::json)::text from supabase_migrations.schema_migrations;"));
	receipt.migrations = { source: manifest.migrations.length, restored: restoredHistory.length,
		same: JSON.stringify(restoredHistory) === JSON.stringify(manifest.migrations) };
	const managedRestored = JSON.parse(restoredSql(MANAGED_OBJECTS_SQL));
	const restoredNames = [...managedRestored.policies, ...managedRestored.triggers];
	receipt.managedSchemaObjects = {
		source: { policies: manifest.managed.policies.length, triggers: manifest.managed.triggers.length },
		missing: [...manifest.managed.policies, ...manifest.managed.triggers].filter((name) => !restoredNames.includes(name))
	};
	const readBack = new Map();
	for (const object of manifest.objects) {
		const body = Buffer.from(await (await storage(localApi, localKey, `object/authenticated/${objectPath(object.bucket, object.name)}`)).arrayBuffer());
		readBack.set(`${object.bucket}/${object.name}`, { bytes: body.length, sha256: sha256(body) });
	}
	receipt.objects = { backedUp: manifest.objects.length, bytes: manifest.objects.reduce((sum, object) => sum + object.bytes, 0), restored: readBack.size };
	receipt.objectMismatches = objectMismatches(manifest.objects.map(({ bucket, name, recordedBytes }) => ({ bucket, name, size: recordedBytes })),
		new Map(manifest.objects.map((object) => [`${object.bucket}/${object.name}`, { bytes: object.bytes }])));
	receipt.restoredFileMismatches = manifest.objects.filter((object) => readBack.get(`${object.bucket}/${object.name}`)?.sha256 !== object.sha256)
		.map((object) => `${object.bucket}/${object.name}`);

	receipt.ok = receipt.rowMismatches.length === 0 && receipt.migrations.same && receipt.managedSchemaObjects.missing.length === 0
		&& receipt.objectFailures.length === 0 && receipt.objectMismatches.length === 0 && receipt.restoredFileMismatches.length === 0;
	if (!receipt.ok) process.exitCode = 1;
} catch (error) {
	receipt.error = redact(error.message);
	process.exitCode = 1;
} finally {
	if (rehearsalProbe) {
		receipt.rehearsalFileRemoved = await rehearsalProbe.remove();
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

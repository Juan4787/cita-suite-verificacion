import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_API_ORIGIN, PRODUCTION_REF, productionEnvironment } from './lib/production-database.mjs';
import { createSupabaseBackup } from './lib/supabase-backup.mjs';
import { psqlDiagnostics } from './lib/staging-database.mjs';

// Backs up production with the procedure the staging rehearsal restores in full
// (lib/supabase-backup.mjs, scripts/backup-rehearsal.mjs), from this machine into a private
// directory outside the repository. Production credentials come from the existing private
// configuration and never reach a log, the repository or CI. Every query is read-only.
const root = fileURLToPath(new URL('../', import.meta.url));
// pg_dump needs a session, which the pooler serves on port 5432.
const { env, database } = productionEnvironment(root);
if (env.ODONTO_SUPABASE_URL?.replace(/\/$/, '') !== PRODUCTION_API_ORIGIN) throw new Error('The production API is not the expected one. Nothing was read.');
const serviceKey = env.ODONTO_SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!/^[\w.-]{20,}$/.test(serviceKey)) throw new Error('The production service key is required to back up stored files.');
const directory = process.argv[2] ?? join(homedir(), '.local/share/cita-suite/backups', `production-${new Date().toISOString().replace(/[:.]/g, '-')}`);
if (existsSync(directory)) throw new Error('The backup directory already exists; a backup never overwrites another.');
const redact = (text) => String(text ?? '').replaceAll(database.href, '[production-url]').replaceAll(decodeURIComponent(database.password), '[secret]').slice(-4000);

function readJson(sql) {
	const result = spawnSync('psql', ['-X', '-h', database.hostname, '-p', database.port, '-U', decodeURIComponent(database.username), '-d', 'postgres',
		'-v', 'ON_ERROR_STOP=1', '-Atq', '-f', '-'], {
		input: `begin transaction read only;\n${sql}\ncommit;\n`, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 ** 2,
		env: { ...process.env, PGPASSWORD: decodeURIComponent(database.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10',
			PGOPTIONS: '-c statement_timeout=60000 -c application_name=cita_suite_production_backup' }
	});
	if (result.error || result.status !== 0) throw new Error('Production query failed.\n' + redact(psqlDiagnostics(result.stderr)));
	return JSON.parse(result.stdout.split('\n').filter((line) => line && line !== 'BEGIN' && line !== 'COMMIT').join('\n'));
}

// The CLI runs in an empty working directory, as in the rehearsal: the repository's linked
// project would make it pick that project's image instead of the pinned one.
const workdir = mkdtempSync(join(tmpdir(), 'cita-production-backup-'));
const manifest = await createSupabaseBackup({
	directory,
	source: { projectRef: PRODUCTION_REF },
	dump: (args) => {
		const result = spawnSync('pnpm', ['exec', 'supabase', 'db', 'dump', '--db-url', database.href, '--workdir', workdir, ...args], { cwd: root, encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 ** 2 });
		if (result.error || result.status !== 0)
			throw new Error('supabase db dump failed.\n' + redact(result.error?.message ?? `${result.stderr}\n${result.stdout}`));
	},
	readJson,
	storageGet: async (bucket, name) => {
		const path = `${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`;
		for (let attempt = 1; ; attempt++) {
			const response = await fetch(`${PRODUCTION_API_ORIGIN}/storage/v1/object/authenticated/${path}`, {
				headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey }, redirect: 'error', signal: AbortSignal.timeout(30_000)
			}).catch(() => null);
			if (response?.ok) return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
			if (attempt >= 3 || (response && response.status !== 429 && response.status < 500)) throw new Error(`Storage answered ${response?.status ?? 'without response'}.`);
			await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
		}
	}
});
rmSync(workdir, { recursive: true, force: true });
chmodSync(directory, 0o700);
const rows = Object.values(manifest.rows).reduce((sum, count) => sum + count, 0);
console.log(JSON.stringify({
	directory, projectRef: PRODUCTION_REF, createdAt: manifest.createdAt, dumpMs: manifest.dumpMs,
	files: Object.fromEntries(Object.entries(manifest.files).map(([name, file]) => [name, file.bytes])),
	tables: Object.keys(manifest.rows).length, rows, migrations: manifest.migrations.length,
	managed: { policies: manifest.managed.policies.length, triggers: manifest.managed.triggers.length },
	objects: manifest.objects.length, objectFailures: manifest.objectFailures.length
}, null, 2));
if (manifest.objectFailures.length) process.exitCode = 1;

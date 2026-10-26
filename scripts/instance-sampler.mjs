import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_REF, productionEnvironment, readEnvFile } from './lib/production-database.mjs';
import { STAGING_PROJECT_REF, stagingConnection } from './lib/staging-database.mjs';

// Samples a hosted Supabase project while a measurement runs, to attribute its pauses: the
// instance's own metrics every 5 s (CPU time by mode, including steal and iowait; CPU, I/O and
// memory pressure; swap; disk; checkpoints) from the project's metrics endpoint, and every 2 s
// what each active session is waiting on (pg_stat_activity), through one read-only session.
// Only counters and wait event names are kept: no query text, row or credential. `light` keeps
// only the metrics, once a minute, and opens no database session: it observes a whole measurement,
// including the time after a seed, without adding a load of its own to the instance it measures.
const root = fileURLToPath(new URL('../', import.meta.url));
const [target, minutesArgument, label, mode] = process.argv.slice(2);
const minutes = Number(minutesArgument);
const light = mode === 'light';
if (!['staging', 'production'].includes(target) || !Number.isInteger(minutes) || minutes < 1 || minutes > (light ? 240 : 120) ||
	!/^[a-z0-9-]{3,40}$/.test(label ?? '') || (mode !== undefined && !light) || process.argv.length > 6)
	throw new Error('Usage: instance-sampler.mjs staging|production <minutes 1-120, or 1-240 with light> <label> [light]');
const metricsIntervalMs = light ? 60_000 : 5_000;

const ref = target === 'staging' ? STAGING_PROJECT_REF : PRODUCTION_REF;
let database;
let serviceKey;
if (target === 'staging') {
	const staging = join(homedir(), '.config/cita-suite/staging');
	database = stagingConnection(readEnvFile(join(staging, 'connection.env')).CITA_STAGING_DATABASE_URL);
	serviceKey = JSON.parse(readFileSync(join(staging, 'api-keys.json'), 'utf8')).find((key) => key?.name === 'service_role' && key?.type === 'legacy')?.api_key;
} else {
	const production = productionEnvironment(root);
	database = production.database;
	serviceKey = production.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
}
if (!serviceKey) throw new Error('The service key of the project is missing. Nothing was sampled.');

const output = join(root, '.verification', `instance-samples-${target}-${label}.jsonl`);
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(output, '');
const until = Date.now() + minutes * 60_000;

// Counters summed over CPUs and devices; a sample keeps their raw values.
const WANTED = /^(node_cpu_seconds_total|node_pressure_\w+_seconds_total|node_vmstat_pswp(in|out)|node_vmstat_pgmajfault|node_disk_io_time_seconds_total|node_disk_(reads|writes)_completed_total|node_memory_(MemAvailable|SwapFree)_bytes|node_load1|pg_stat_bgwriter_checkpoints_(req|timed)_total|pg_stat_bgwriter_checkpoint_(write|sync)_time_total|pg_stat_database_blks_read_total)$/;
function parseMetrics(text) {
	const values = {};
	for (const line of text.split('\n')) {
		if (!line || line.startsWith('#')) continue;
		const match = /^([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+([-+0-9.eE]+|NaN)/.exec(line);
		if (!match || !WANTED.test(match[1])) continue;
		const mode = /mode="([^"]+)"/.exec(match[2] ?? '')?.[1];
		const key = match[1] === 'node_cpu_seconds_total' ? `cpu_${mode}` : match[1];
		values[key] = (values[key] ?? 0) + Number(match[3]);
	}
	return values;
}
const authorization = 'Basic ' + Buffer.from(`service_role:${serviceKey}`).toString('base64');
async function sampleMetrics() {
	while (Date.now() < until) {
		const at = new Date().toISOString();
		try {
			const response = await fetch(`https://${ref}.supabase.co/customer/v1/privileged/metrics`, {
				headers: { Authorization: authorization }, signal: AbortSignal.timeout(4_000) });
			appendFileSync(output, JSON.stringify(response.ok ? { at, kind: 'metrics', values: parseMetrics(await response.text()) } : { at, kind: 'metrics', status: response.status }) + '\n');
		} catch (error) {
			appendFileSync(output, JSON.stringify({ at, kind: 'metrics', error: error.name }) + '\n');
		}
		await new Promise((resolve) => setTimeout(resolve, metricsIntervalMs));
	}
}

// One read-only session receives the same statement every 2 s on its input.
const WAITS = `select json_build_object('at', clock_timestamp(), 'kind', 'waits', 'waits', coalesce((
	select json_object_agg(event, sessions) from (select coalesce(wait_event_type || ':' || wait_event, 'CPU') as event, count(*) as sessions
	from pg_stat_activity where state = 'active' and pid <> pg_backend_pid() and backend_type = 'client backend' group by 1) w), '{}'::json))::text;`;
function sampleWaits() {
	return new Promise((resolve) => {
		const psql = spawn('psql', ['-X', '-h', database.hostname, '-p', database.port, '-U', decodeURIComponent(database.username), '-d', 'postgres', '-Atq'], {
			env: { ...process.env, PGPASSWORD: decodeURIComponent(database.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10',
				PGAPPNAME: 'cita_suite_instance_sampler' }, stdio: ['pipe', 'pipe', 'pipe'] });
		let pending = '';
		psql.stdout.on('data', (chunk) => {
			pending += chunk;
			const lines = pending.split('\n');
			pending = lines.pop();
			for (const line of lines) if (line.startsWith('{')) appendFileSync(output, line + '\n');
		});
		psql.stderr.on('data', () => {});
		psql.stdin.write('set session characteristics as transaction read only;\n');
		const ask = setInterval(() => {
			if (Date.now() >= until) { clearInterval(ask); psql.stdin.end(); return; }
			psql.stdin.write(WAITS.replaceAll('\n', ' ') + '\n');
		}, 2_000);
		psql.on('exit', () => { clearInterval(ask); resolve(); });
	});
}

await Promise.all(light ? [sampleMetrics()] : [sampleMetrics(), sampleWaits()]);
console.log(JSON.stringify({ target, label, samples: readFileSync(output, 'utf8').split('\n').filter(Boolean).length, output }));

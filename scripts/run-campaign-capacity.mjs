import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixturePath } from './lib/fixture-path.mjs';
import { acquireVerificationLock } from './lib/verification-lock.mjs';
import { cleanupFixtureResources } from './lib/fixture-cleanup.mjs';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';
import { assertPlatformDiagnostics } from './lib/platform-diagnostics.mjs';
import { createRandom, evaluateAcceptance, login, practiceData, runVirtualUser, summarize, uuidFrom } from './lib/capacity-load.mjs';

// Capacity scenarios of the plan on the disposable stack of CI: PostgreSQL with 4 GB
// and two CPUs, real Auth and a PostgREST that runs requests as the hosted platform
// does. Each scenario starts from a fresh database with only the migrations, seeds
// its synthetic practices through the real triggers and serves the production build
// of the app in workerd, the runtime of Cloudflare. One virtual user per practice
// then works for three repetitions of two minutes of warm-up and ten of measurement.
// Results describe this container, never the capacity of a hosted project.
const root = fileURLToPath(new URL('../', import.meta.url));
const seedOnly = process.argv[2] === '--seed-only';
if (process.argv.length > 3 || (process.argv.length === 3 && !seedOnly))
	throw new Error('Usage: run-campaign-capacity.mjs [--seed-only]. Seeding alone never counts as a capacity result.');
assertHostedIntegrationResources();
const lease = acquireVerificationLock(root);
const campaignId = process.env.CITA_VERIFICATION_RUN_ID ?? randomUUID();
if (!/^[a-f0-9-]{36}$/.test(campaignId)) throw new Error('Invalid campaign evidence identifier.');
const evidence = join(root, '.verification', 'runs', campaignId, 'capacity');
mkdirSync(evidence, { recursive: true });
const environment = { ...process.env, CITA_FIXTURE_PROFILE: 'capacity' };
const appOrigin = 'http://127.0.0.1:8787';
const WARMUP_MS = 2 * 60_000;
const MEASURE_MS = 10 * 60_000;
const REPETITIONS = 3;
let active;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
	interrupted = true;
	if (active) try { process.kill(-active.pid, 'SIGTERM'); } catch {}
});

async function run(command, args, options = {}) {
	if (interrupted) throw new Error('Capacity verification interrupted.');
	active = spawn(command, args, { cwd: root, env: environment, stdio: 'inherit', detached: true, ...options });
	const result = await new Promise(resolve => {
		active.once('error', error => resolve({ error }));
		active.once('exit', (status, signal) => resolve({ status, signal }));
	});
	active = undefined;
	if (interrupted || result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status ?? result.signal ?? 'start error'}).`);
}

function psql(database, sql, variables = {}) {
	const result = spawnSync('docker', ['exec', '-i', database, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq',
		...Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`]), '-f', '-'],
	{ input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2, timeout: 3_600_000 });
	if (result.error || result.status !== 0) throw new Error('Capacity SQL failed.\n' + String(result.stderr).split('\n').filter(line => /ERROR|DETAIL|CONTEXT|HINT/.test(line)).slice(0, 12).join('\n'));
	return result.stdout.trim();
}

// The same query without blocking the event loop, for sampling during the load:
// a synchronous call would stall the virtual users and inflate their latencies.
function psqlAsync(database, sql) {
	return new Promise(resolve => {
		const child = spawn('docker', ['exec', '-i', database, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', sql]);
		let output = '';
		child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
		child.on('error', () => resolve(null));
		child.on('exit', status => resolve(status === 0 ? output.trim() : null));
	});
}

async function stop(child) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
	await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 15000))]);
	if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

async function services(database) {
	const log = openSync(join(evidence, `platform-${database}.log`), 'w', 0o600);
	const platform = spawn('node', ['scripts/serve-booking-fixture.mjs', database, '--real-auth', '--no-app'], { cwd: root, env: environment, stdio: ['ignore', log, log] });
	for (let attempt = 0; attempt < 240; attempt++) {
		if (platform.exitCode !== null) throw new Error('The capacity services exited. Read the platform log of this scenario.');
		if (existsSync(fixturePath('runtime.json'))) {
			const runtime = JSON.parse(readFileSync(fixturePath('runtime.json'), 'utf8'));
			if (runtime.container === database && runtime.realAuth) {
				try { if ((await fetch(runtime.apiOrigin + '/auth/v1/health', { signal: AbortSignal.timeout(1000) })).ok) return { platform, runtime }; } catch {}
			}
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	await stop(platform);
	throw new Error('The capacity services did not become ready.');
}

// One owner per practice, created through the Auth admin API like any account.
async function createOwners(runtime, practices, password) {
	const owners = [];
	for (let practice = 1; practice <= practices; practice++) {
		const id = uuidFrom('capacity-owner-' + practice);
		const response = await fetch(runtime.apiOrigin + '/auth/v1/admin/users', {
			method: 'POST', signal: AbortSignal.timeout(10_000),
			headers: { authorization: 'Bearer ' + runtime.service, apikey: runtime.service, 'content-type': 'application/json' },
			body: JSON.stringify({ id, email: practiceData(practice).email, password, email_confirm: true, role: 'authenticated' })
		});
		const user = await response.json().catch(() => null);
		if (!response.ok || user?.id !== id) throw new Error(`Could not create capacity owner ${practice} (HTTP ${response.status}).`);
		owners.push(id);
	}
	return owners;
}

// The production Cloudflare build, served by workerd against the disposable services.
async function application(runtime, practices) {
	const directory = mkdtempSync(join(tmpdir(), 'cita-capacity-app-'));
	const build = join(root, 'apps/web/.svelte-kit/cloudflare');
	writeFileSync(join(directory, 'wrangler.json'), JSON.stringify({
		name: 'cita-suite-capacity', main: join(build, '_worker.js'), assets: { binding: 'ASSETS', directory: build },
		compatibility_date: '2026-05-03', compatibility_flags: ['nodejs_compat'],
		vars: {
			PUBLIC_SITE_URL: appOrigin, ODONTO_SUPABASE_URL: runtime.apiOrigin, PUBLIC_ODONTO_SUPABASE_URL: runtime.apiOrigin,
			ODONTO_SUPABASE_ANON_KEY: runtime.anon, PUBLIC_ODONTO_SUPABASE_ANON_KEY: runtime.anon, ODONTO_SUPABASE_SERVICE_ROLE_KEY: runtime.service,
			BOOKING_CONTEXTS_AVAILABLE: 'true', BOOKING_INTEGRATIONS_ENABLED: 'true', BOOKING_INFORMATION_ENABLED: 'true', DEMO_MODE: 'false',
			RATE_LIMIT_SALT: 'cita-capacity-local-only', JOB_BUDGET_PROFILE: 'free', MASTER_EMAIL: 'master@cita-suite-test.local'
		}
	}), { mode: 0o600 });
	const log = openSync(join(evidence, `application-${practices}.log`), 'w', 0o600);
	const child = spawn('pnpm', ['--filter', 'web', 'exec', 'wrangler', 'dev', '--config', join(directory, 'wrangler.json'), '--ip', '127.0.0.1', '--port', '8787', '--local'],
		{ cwd: root, env: { ...environment, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', log, log], detached: true });
	for (let attempt = 0; attempt < 240; attempt++) {
		if (child.exitCode !== null) break;
		try { if ((await fetch(appOrigin + '/login', { signal: AbortSignal.timeout(2000) })).ok) return { child, directory }; } catch {}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	await stop(child);
	rmSync(directory, { recursive: true, force: true });
	throw new Error('The built application did not start in workerd. Read the application log of this scenario.');
}

const DATABASE_STATISTICS = `select json_build_object(
 'statements',(select coalesce(json_agg(s),'[]'::json) from (select left(regexp_replace(query,'\\s+',' ','g'),400) as query,calls,
   round(total_exec_time::numeric,1) as total_ms,round(mean_exec_time::numeric,3) as mean_ms,round(max_exec_time::numeric,1) as max_ms,rows
   from extensions.pg_stat_statements where dbid=(select oid from pg_database where datname=current_database())
   order by total_exec_time desc limit 25) s),
 'database',(select row_to_json(d) from (select xact_commit,xact_rollback,deadlocks,temp_files,temp_bytes,blks_read,blks_hit
   from pg_stat_database where datname=current_database()) d))`;

// Isolation and double booking after the load: every appointment the virtual users
// created belongs to their own practice and no active appointments of a professional overlap.
const INTEGRITY = `select json_build_object(
 'crossPractice',(select count(*) from public.appointments a join public.business_users u on u.user_id=a.created_by_user_id
   where a.created_at>now()-interval '2 hours' and u.role='owner' and u.business_id<>a.business_id),
 'overlaps',(select count(*) from public.appointments a join public.appointments b on b.business_id=a.business_id
   and b.professional_id=a.professional_id and b.id>a.id and tstzrange(b.blocking_starts_at,b.blocking_ends_at,'[)')&&tstzrange(a.blocking_starts_at,a.blocking_ends_at,'[)')
   where a.status in ('reserved','confirmed','reschedule_requested') and b.status in ('reserved','confirmed','reschedule_requested')),
 'createdByLoad',(select count(*) from public.appointments where created_at>now()-interval '2 hours' and created_by_user_id is not null),
 'entriesByLoad',(select count(*) from public.clinical_entries where description='Control de capacidad'))`;

async function measure(database, practices, password) {
	psql(database, 'create extension if not exists pg_stat_statements with schema extensions;');
	const jars = [];
	const loginStarted = Date.now();
	for (let practice = 1; practice <= practices; practice++) jars.push(await login(appOrigin, practiceData(practice).email, password));
	const repetitions = [];
	for (let repetition = 1; repetition <= REPETITIONS; repetition++) {
		psql(database, 'select extensions.pg_stat_statements_reset();');
		const started = Date.now();
		const measureFrom = started + WARMUP_MS;
		const until = measureFrom + MEASURE_MS;
		const samples = [];
		const waits = [];
		const sampler = setInterval(async () => {
			if (Date.now() < measureFrom) return;
			const value = await psqlAsync(database, 'select count(*) from pg_locks where not granted');
			if (value !== null) waits.push(Number(value));
		}, 10_000);
		try {
			await Promise.all(jars.map((jar, index) => runVirtualUser({ origin: appOrigin, jar, data: practiceData(index + 1),
				random: createRandom(`capacity-${practices}-${repetition}-${index + 1}`), measureFrom, until, record: sample => samples.push(sample) })));
		} finally { clearInterval(sampler); }
		const summary = summarize(samples);
		repetitions.push({ repetition, summary, acceptance: evaluateAcceptance(summary),
			lockWaits: { samples: waits.length, max: Math.max(0, ...waits), mean: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0 },
			database: JSON.parse(psql(database, DATABASE_STATISTICS)) });
		console.log(`capacity-repetition ${practices}/${repetition} ` + JSON.stringify({ read: summary.read, write: summary.write, acceptance: repetitions.at(-1).acceptance }));
	}
	return { logins: { count: practices, durationMs: Date.now() - loginStarted }, repetitions, integrity: JSON.parse(psql(database, INTEGRITY)) };
}

// Plans of the statements that took longer than 250 ms, logged by auto_explain.
function slowPlans(database) {
	const logs = spawnSync('docker', ['logs', database], { encoding: 'utf8', maxBuffer: 64 * 1024 ** 2 });
	const plans = [];
	for (const line of `${logs.stdout}\n${logs.stderr}`.split('\n')) {
		const match = /duration: ([\d.]+) ms\s+plan:\s*(\{.*\})\s*$/.exec(line);
		if (!match) continue;
		try {
			const plan = JSON.parse(match[2]);
			plans.push({ durationMs: Number(match[1]), query: String(plan['Query Text'] ?? '').replace(/\s+/g, ' ').slice(0, 400), plan: plan.Plan });
		} catch {}
	}
	return plans.sort((a, b) => b.durationMs - a.durationMs).slice(0, 15);
}

async function scenario(practices) {
	const runId = randomUUID();
	environment.CITA_FIXTURE_RUN_ID = runId;
	let platform;
	let app;
	let failure;
	try {
		await run('node', ['scripts/test-booking-foundation.mjs', '--keep', '--prepare-only']);
		const database = JSON.parse(readFileSync(fixturePath('database.json'), 'utf8')).container;
		if (!/^cita-booking-test-[a-f0-9]{12}$/.test(database)) throw new Error('Invalid disposable database receipt.');
		const started = await services(database);
		platform = started.platform;
		const password = randomBytes(18).toString('base64url');
		const owners = await createOwners(started.runtime, practices, password);
		const seedStarted = performance.now();
		const output = psql(database, readFileSync(join(root, 'scripts/capacity/seed-practices.sql'), 'utf8'),
			{ practices: String(practices), owners: JSON.stringify(owners) });
		const seed = JSON.parse(output.split('\n').at(-1));
		seed.durationMs = Math.round(performance.now() - seedStarted);
		if (seed.practices !== practices || seed.patients !== 6000 * practices || seed.appointments !== 12000 * practices)
			throw new Error('The capacity seed does not match its scenario: ' + JSON.stringify(seed));
		const result = { practices, seed };
		if (!seedOnly) {
			app = await application(started.runtime, practices);
			Object.assign(result, await measure(database, practices, password));
			result.slowPlans = slowPlans(database);
			result.passed = result.repetitions.every(item => item.acceptance.passed) &&
				result.integrity.crossPractice === 0 && result.integrity.overlaps === 0 &&
				result.repetitions.every(item => item.database.database.deadlocks === 0);
		}
		writeFileSync(join(evidence, `scenario-${practices}.json`), JSON.stringify(result, null, 2) + '\n');
		console.log('capacity-scenario ' + JSON.stringify({ practices, seed, passed: result.passed, integrity: result.integrity }));
		return result;
	} catch (error) {
		failure = error;
		throw error;
	} finally {
		// Stop the app and the services, letting them clean their own containers before
		// the owned-resource cleanup; a cleanup problem never hides an earlier failure.
		if (app) { await stop(app.child); rmSync(app.directory, { recursive: true, force: true }); }
		await stop(platform);
		const problems = [];
		const state = fixturePath(`platform-state-${runId}.json`);
		try {
			if (existsSync(state)) {
				copyFileSync(state, join(evidence, `platform-state-${practices}.json`));
				assertPlatformDiagnostics(JSON.parse(readFileSync(state, 'utf8')));
			} else if (platform) problems.push(new Error('The platform diagnostics of this scenario are missing.'));
		} catch (error) { problems.push(error); }
		try { cleanupFixtureResources(runId); } catch (error) { problems.push(error); }
		if (problems.length) {
			if (failure) for (const problem of problems) console.error('After the failure above: ' + problem.message);
			else throw new AggregateError(problems, `Capacity scenario ${practices} did not close cleanly.`);
		}
	}
}

try {
	if (!seedOnly) await run('pnpm', ['--filter', 'web', 'build:cloudflare'], { env: { ...environment, CITA_BUILD_VERSION: process.env.GITHUB_SHA ?? 'capacity-local' } });
	const results = [];
	for (const practices of [5, 25]) results.push(await scenario(practices));
	const summary = { seedOnly, scenarios: results.map(({ practices, seed, passed, integrity, repetitions }) => ({ practices, seed, passed, integrity,
		repetitions: repetitions?.map(({ repetition, summary, acceptance, lockWaits }) => ({ repetition, read: summary.read, write: summary.write, acceptance, lockWaits })) })),
	scope: 'Disposable CI container: PostgreSQL 4 GB and 2 CPUs, real Auth, PostgREST as authenticator, the production build in workerd. Not hosted capacity.' };
	writeFileSync(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
	if (seedOnly) console.log('Seeding diagnostic completed; this is not a capacity result.');
	else if (!results.every(result => result.passed)) throw new Error('A capacity scenario did not meet the acceptance criteria of the plan; read summary.json.');
} catch (error) {
	console.error(error);
	process.exitCode = 1;
} finally {
	lease.release();
}

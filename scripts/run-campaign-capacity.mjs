import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixturePath } from './lib/fixture-path.mjs';
import { acquireVerificationLock } from './lib/verification-lock.mjs';
import { cleanupFixtureResources } from './lib/fixture-cleanup.mjs';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';
import { assertPlatformDiagnostics } from './lib/platform-diagnostics.mjs';
import { connectInspector, summarizeCpuProfile } from './lib/cpu-profile.mjs';
import {
	INTEGRITY_SQL, createRandom, describePublicPage, evaluateAcceptance, evaluateCleanup, localDate, login, practiceData, removeCapacityOwners,
	runPublicAbuse, runPublicGenerator, runVirtualUser, summarize, uuidFrom
} from './lib/capacity-load.mjs';

// Capacity scenarios of the plan on the disposable stack of CI: PostgreSQL with 4 GB
// and two CPUs, real Auth and a PostgREST that runs requests as the hosted platform
// does. Each scenario starts from a fresh database with only the migrations, seeds
// its synthetic practices through the real triggers and serves the production build
// of the app in workerd, the runtime of Cloudflare. One virtual user per practice
// then works for three repetitions of two minutes of warm-up and ten of measurement.
// Results describe this container, never the capacity of a hosted project.
const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? 'full';
if (process.argv.length > 3 || !['full', '--seed-only', '--quick', '--profile'].includes(mode))
	throw new Error('Usage: run-campaign-capacity.mjs [--seed-only|--quick|--profile]. No diagnostic counts as a capacity result.');
const seedOnly = mode === '--seed-only';
// The short pass also profiles the app's CPU in workerd: Workers Free allows 10 ms
// per request, and the profile shows where each phase spends it.
const profiling = mode === '--profile';
// A short pass over the whole pipeline, with the five-practice scenario only.
const quick = mode === '--quick' || profiling;
assertHostedIntegrationResources();
const lease = acquireVerificationLock(root);
const campaignId = process.env.CITA_VERIFICATION_RUN_ID ?? randomUUID();
if (!/^[a-f0-9-]{36}$/.test(campaignId)) throw new Error('Invalid campaign evidence identifier.');
const evidence = join(root, '.verification', 'runs', campaignId, 'capacity');
mkdirSync(evidence, { recursive: true });
const environment = { ...process.env, CITA_FIXTURE_PROFILE: 'capacity' };
const appOrigin = 'http://127.0.0.1:8787';
const WARMUP_MS = quick ? 30_000 : 2 * 60_000;
const MEASURE_MS = quick ? 3 * 60_000 : 10 * 60_000;
const REPETITIONS = quick ? 1 : 3;
// SvelteKit's own decoder of page data, resolved through the app's dependency.
const kitRequire = createRequire(createRequire(join(root, 'apps/web/package.json')).resolve('@sveltejs/kit/package.json'));
const devalue = await import(pathToFileURL(kitRequire.resolve('devalue')).href);
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
	const child = spawn('pnpm', ['--filter', 'web', 'exec', 'wrangler', 'dev', '--config', join(directory, 'wrangler.json'), '--ip', '127.0.0.1', '--port', '8787', '--local',
		...(profiling ? ['--inspector-port', String(INSPECTOR_PORT)] : [])],
		{ cwd: root, env: { ...environment, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', log, log], detached: true });
	for (let attempt = 0; attempt < 240; attempt++) {
		if (child.exitCode !== null) break;
		let ready = false;
		try { ready = (await fetch(appOrigin + '/login', { signal: AbortSignal.timeout(2000) })).ok; } catch {}
		if (ready) {
			// A failure of the profiler surfaces as itself, not as an app that never started.
			try { return { child, directory, profiler: profiling ? await openProfiler() : null }; } catch (error) {
				await stop(child);
				rmSync(directory, { recursive: true, force: true });
				throw error;
			}
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	await stop(child);
	rmSync(directory, { recursive: true, force: true });
	throw new Error('The built application did not start in workerd. Read the application log of this scenario.');
}

// The app Worker's inspector, through which the DevTools profiler samples its CPU.
const INSPECTOR_PORT = 9229;
async function openProfiler() {
	const answers = new Map();
	for (let attempt = 0; attempt < 40; attempt++) {
		for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
			try {
				const response = await fetch(`http://${host}:${INSPECTOR_PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
				const targets = await response.json().catch(() => null);
				answers.set(host, `HTTP ${response.status}, ${Array.isArray(targets) ? targets.length + ' targets' : 'no target list'}`);
				const target = Array.isArray(targets) ? targets.find(item => typeof item.webSocketDebuggerUrl === 'string') : null;
				if (target) {
					const client = await connectInspector(target.webSocketDebuggerUrl);
					await client.send('Profiler.enable');
					await client.send('Profiler.setSamplingInterval', { interval: 1000 });
					return client;
				}
			} catch (error) { answers.set(host, String(error?.cause?.code ?? error?.name ?? 'error')); }
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	throw new Error('The workerd inspector offered no target to profile: ' + JSON.stringify(Object.fromEntries(answers)));
}

// Profiles one phase from the start of its measured window until its work ends.
const startProfileAt = (profiler, at) => profiler && new Promise((resolve, reject) =>
	setTimeout(() => profiler.send('Profiler.start').then(resolve, reject), Math.max(0, at - Date.now())));
async function finishProfile(profiler, started, phase, requests) {
	if (!profiler) return null;
	await started;
	const { profile } = await profiler.send('Profiler.stop');
	const summary = summarizeCpuProfile(profile, { top: 40 });
	const result = { phase, requests, busyMsPerRequest: requests ? Math.round(summary.busyMs / requests * 100) / 100 : null, ...summary };
	writeFileSync(join(evidence, `cpu-profile-${phase}.json`), JSON.stringify(result, null, 2) + '\n');
	console.log(`capacity-cpu-profile ${phase} ` + JSON.stringify({ requests, busyMs: summary.busyMs, busyMsPerRequest: result.busyMsPerRequest,
		self: summary.self.slice(0, 30), total: summary.total.slice(0, 30) }));
	return result;
}

const DATABASE_STATISTICS = `select jsonb_build_object(
 'statements',(select coalesce(jsonb_agg(s),'[]'::jsonb) from (select left(regexp_replace(query,'\\s+',' ','g'),400) as query,calls,
   round(total_exec_time::numeric,1) as total_ms,round(mean_exec_time::numeric,3) as mean_ms,round(max_exec_time::numeric,1) as max_ms,rows
   from extensions.pg_stat_statements where dbid=(select oid from pg_database where datname=current_database())
   order by total_exec_time desc limit 25) s),
 'database',(select to_jsonb(d) from (select xact_commit,xact_rollback,deadlocks,temp_files,temp_bytes,blks_read,blks_hit
   from pg_stat_database where datname=current_database()) d))`;

async function measure(database, practices, password, profiler) {
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
		const profileStarted = startProfileAt(profiler, measureFrom);
		try {
			await Promise.all(jars.map((jar, index) => runVirtualUser({ origin: appOrigin, jar, data: practiceData(index + 1),
				random: createRandom(`capacity-${practices}-${repetition}-${index + 1}`), measureFrom, until, record: sample => samples.push(sample) })));
		} finally { clearInterval(sampler); }
		const summary = summarize(samples);
		repetitions.push({ repetition, summary, acceptance: evaluateAcceptance(summary),
			lockWaits: { samples: waits.length, max: Math.max(0, ...waits), mean: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0 },
			database: JSON.parse(psql(database, DATABASE_STATISTICS)),
			cpuProfile: await finishProfile(profiler, profileStarted, 'internal', summary.all.count) });
		console.log(`capacity-repetition ${practices}/${repetition} ` + JSON.stringify({ read: summary.read, write: summary.write, acceptance: repetitions.at(-1).acceptance }));
	}
	return { logins: { count: practices, durationMs: Date.now() - loginStarted }, repetitions, integrity: JSON.parse(psql(database, INTEGRITY_SQL)) };
}

// Public booking on its own: one generator within the limits, then the abuse checks.
async function measurePublic(practices, profiler) {
	// What each public entry answers for one practice on its next weekday.
	const data = practiceData(1);
	let day = 1;
	while ([0, 6].includes(new Date(localDate(new Date(), day) + 'T12:00:00Z').getUTCDay())) day++;
	const query = `service_id=${data.services[0]}&professional_id=${data.professionals[0]}&date=${localDate(new Date(), day)}`;
	const describe = async path => {
		const response = await fetch(appOrigin + path).catch(() => null);
		return describePublicPage(response?.status ?? 0, await response?.json().catch(() => null), devalue.unflatten);
	};
	const entries = { link: await describe(`/reservar/${data.slug}/__data.json?${query}`), page: await describe(`/reservar/${data.business}/__data.json?${query}`),
		embed: await describe(`/embed/v1/${data.integrationKey}/__data.json?${query}`) };
	console.log(`capacity-public-entries ${practices} ` + JSON.stringify(entries));
	const repetitions = [];
	let phone = '+5491177000000';
	for (let repetition = 1; repetition <= REPETITIONS; repetition++) {
		const measureFrom = Date.now() + WARMUP_MS;
		const until = measureFrom + MEASURE_MS;
		const samples = [];
		const profileStarted = startProfileAt(profiler, measureFrom);
		const generated = await runPublicGenerator({ origin: appOrigin, practices, random: createRandom(`public-${practices}-${repetition}`), measureFrom, until,
			record: sample => samples.push(sample), unflatten: devalue.unflatten, parse: devalue.parse, phone });
		phone = generated.phone;
		const summary = summarize(samples);
		repetitions.push({ repetition, summary, acceptance: evaluateAcceptance(summary), bookingFailures: generated.failures,
			cpuProfile: await finishProfile(profiler, profileStarted, 'public', summary.all.count) });
		console.log(`capacity-public ${practices}/${repetition} ` + JSON.stringify({ read: summary.read, write: summary.write,
			acceptance: repetitions.at(-1).acceptance, bookingFailures: generated.failures }));
	}
	const abuse = await runPublicAbuse({ origin: appOrigin, unflatten: devalue.unflatten, parse: devalue.parse, phone });
	console.log(`capacity-public-abuse ${practices} ` + JSON.stringify(abuse));
	// One generator, free slots and a different phone each time: every scheduled booking must succeed.
	return { entries, repetitions, abuse,
		passed: repetitions.every(item => item.acceptance.passed && item.bookingFailures.length === 0) && abuse.passed };
}

// The cleanup of the hosted rehearsal, rehearsed here on the same data first: it
// removes the synthetic practices and their owners completely and nothing else.
const REMAINING = `select jsonb_build_object('practices',(select count(*) from public.businesses where slug like 'capacity-%'),
 'owners',(select count(*) from auth.users where email like 'capacity-owner-%@example.test'))::text`;

// Its scope guards act before anything is removed: a member who is not the synthetic
// owner, or a `capacity-` practice that is not one of the seed's, stops it.
function rehearseCleanupGuards(database, script) {
	const refused = (setup, teardown, code) => {
		psql(database, setup);
		let message = '';
		try { psql(database, script); } catch (error) { message = error.message; }
		psql(database, teardown);
		return message.includes(code);
	};
	const foreign = uuidFrom('capacity-foreign-member');
	return {
		foreignMember: refused(`insert into auth.users(id,email) values('${foreign}','capacity-foreign@example.test');
insert into public.business_users(business_id,user_id,role,status,accepted_at) select id,'${foreign}','reception','active',now() from public.businesses where slug='capacity-01';`,
		`delete from public.business_users where user_id='${foreign}'; delete from auth.users where id='${foreign}';`, 'CAPACITY_CLEANUP_FOREIGN_MEMBER'),
		unknownPractice: refused(`update public.businesses set slug='capacity-01-copia' where slug='capacity-01';`,
			`update public.businesses set slug='capacity-01' where slug='capacity-01-copia';`, 'CAPACITY_CLEANUP_UNKNOWN_PRACTICE')
	};
}

async function cleanup(database, runtime, practices) {
	const started = performance.now();
	const script = readFileSync(join(root, 'scripts/capacity/cleanup-practices.sql'), 'utf8');
	const guards = rehearseCleanupGuards(database, script);
	const marked = psql(database, script).split('\n').find(line => line.startsWith('capacity-cleanup '));
	if (!marked) throw new Error('The capacity cleanup printed no result.');
	const removed = JSON.parse(marked.slice('capacity-cleanup '.length));
	const ownersRemoved = await removeCapacityOwners({ practices, request: (path, init = {}) => fetch(runtime.apiOrigin + '/auth/v1/admin' + path,
		{ ...init, signal: AbortSignal.timeout(10_000), headers: { authorization: 'Bearer ' + runtime.service, apikey: runtime.service } }) });
	const result = { guards, ...removed, ownersRemoved, remaining: JSON.parse(psql(database, REMAINING)), durationMs: Math.round(performance.now() - started) };
	result.passed = guards.foreignMember && guards.unknownPractice && evaluateCleanup({ practices, removed, ownersRemoved, remaining: result.remaining });
	console.log('capacity-cleanup ' + JSON.stringify(result));
	return result;
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
		// The same four services as the integration stack, Storage included.
		await run('node', ['scripts/test-booking-foundation.mjs', '--real-storage', '--keep', '--prepare-only']);
		const database = JSON.parse(readFileSync(fixturePath('database.json'), 'utf8')).container;
		if (!/^cita-booking-test-[a-f0-9]{12}$/.test(database)) throw new Error('Invalid disposable database receipt.');
		const started = await services(database);
		platform = started.platform;
		const password = randomBytes(18).toString('base64url');
		const owners = await createOwners(started.runtime, practices, password);
		const seedStarted = performance.now();
		const output = psql(database, readFileSync(join(root, 'scripts/capacity/seed-practices.sql'), 'utf8'),
			{ practices: String(practices), owners: JSON.stringify(owners) });
		const marked = output.split('\n').find(line => line.startsWith('capacity-seed '));
		if (!marked) throw new Error('The capacity seed printed no result.');
		const seed = JSON.parse(marked.slice('capacity-seed '.length));
		seed.durationMs = Math.round(performance.now() - seedStarted);
		if (seed.practices !== practices || seed.patients !== 6000 * practices || seed.appointments !== 12000 * practices)
			throw new Error('The capacity seed does not match its scenario: ' + JSON.stringify(seed));
		const result = { practices, seed };
		if (!seedOnly) {
			app = await application(started.runtime, practices);
			Object.assign(result, await measure(database, practices, password, app.profiler));
			// Public booking is measured once, on the largest scenario of the run.
			if (practices === 25 || quick) result.publicBooking = await measurePublic(practices, app.profiler);
			result.slowPlans = slowPlans(database);
			result.passed = result.repetitions.every(item => item.acceptance.passed) &&
				result.integrity.crossPractice === 0 && result.integrity.overlaps === 0 &&
				result.repetitions.every(item => item.database.database.deadlocks === 0) && (result.publicBooking?.passed ?? true);
		}
		result.cleanup = await cleanup(database, started.runtime, practices);
		if (!seedOnly) result.passed &&= result.cleanup.passed;
		else if (!result.cleanup.passed) throw new Error('The capacity cleanup did not remove exactly the synthetic scenario: ' + JSON.stringify(result.cleanup));
		writeFileSync(join(evidence, `scenario-${practices}.json`), JSON.stringify(result, null, 2) + '\n');
		console.log('capacity-scenario ' + JSON.stringify({ practices, seed, passed: result.passed, integrity: result.integrity }));
		return result;
	} catch (error) {
		failure = error;
		throw error;
	} finally {
		// Stop the app and the services, letting them clean their own containers before
		// the owned-resource cleanup; a cleanup problem never hides an earlier failure.
		if (app) { app.profiler?.close(); await stop(app.child); rmSync(app.directory, { recursive: true, force: true }); }
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
	for (const practices of quick ? [5] : [5, 25]) results.push(await scenario(practices));
	const summary = { mode, scenarios: results.map(({ practices, seed, passed, integrity, repetitions, publicBooking, cleanup }) => ({ practices, seed, passed, integrity,
		repetitions: repetitions?.map(({ repetition, summary, acceptance, lockWaits }) => ({ repetition, read: summary.read, write: summary.write, acceptance, lockWaits })),
		publicBooking: publicBooking && { passed: publicBooking.passed, abuse: publicBooking.abuse,
			repetitions: publicBooking.repetitions.map(({ repetition, summary, acceptance, bookingFailures }) =>
				({ repetition, read: summary.read, write: summary.write, acceptance, bookingFailures })) }, cleanup })),
	scope: 'Disposable CI container: PostgreSQL 4 GB and 2 CPUs, real Auth, PostgREST as authenticator, the production build in workerd. Not hosted capacity.' };
	// Growth with other practices: every practice holds the same data in both scenarios,
	// so a statement much slower with 25 than with 5 is not scoped to its practice.
	const statements = practices => new Map((results.find(result => result.practices === practices)?.repetitions?.at(-1)?.database?.statements ?? [])
		.map(statement => [statement.query, statement]));
	const [small, large] = [statements(5), statements(25)];
	summary.growth = [...large].filter(([query]) => small.has(query)).map(([query, statement]) => ({ query,
		meanMs5: Number(small.get(query).mean_ms), meanMs25: Number(statement.mean_ms), calls25: Number(statement.calls),
		ratio: Number(statement.mean_ms) / Math.max(Number(small.get(query).mean_ms), 0.001) })).sort((a, b) => b.ratio - a.ratio);
	writeFileSync(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
	if (seedOnly || quick) console.log('Capacity diagnostic completed; this is not a capacity result.');
	if (!seedOnly && !results.every(result => result.passed)) throw new Error('A capacity scenario did not meet the acceptance criteria of the plan; read summary.json.');
} catch (error) {
	console.error(error);
	process.exitCode = 1;
} finally {
	lease.release();
}

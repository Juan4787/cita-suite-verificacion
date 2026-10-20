import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixturePath } from './lib/fixture-path.mjs';
import { acquireVerificationLock } from './lib/verification-lock.mjs';
import { cleanupFixtureResources } from './lib/fixture-cleanup.mjs';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';

// Capacity scenarios of the plan on the disposable stack of CI: PostgreSQL with 4 GB
// and two CPUs, real Auth and a PostgREST that runs requests as the hosted platform
// does. Each scenario starts from a fresh database with only the migrations and
// seeds its synthetic practices through the real triggers. Results describe this
// container, never the capacity of a hosted project.
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
const uuidFrom = text => createHash('md5').update(text).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
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

async function services(database) {
	const log = openSync(join(evidence, `platform-${database}.log`), 'w', 0o600);
	const platform = spawn('node', ['scripts/serve-booking-fixture.mjs', database, '--real-auth', '--no-app'], { cwd: root, env: environment, stdio: ['ignore', log, log] });
	let exited = false;
	platform.on('exit', () => { exited = true; });
	for (let attempt = 0; attempt < 240; attempt++) {
		if (exited) throw new Error('The capacity services exited. Read the platform log of this scenario.');
		if (existsSync(fixturePath('runtime.json'))) {
			const runtime = JSON.parse(readFileSync(fixturePath('runtime.json'), 'utf8'));
			if (runtime.container === database && runtime.realAuth) {
				try { if ((await fetch(runtime.apiOrigin + '/auth/v1/health', { signal: AbortSignal.timeout(1000) })).ok) return { platform, runtime }; } catch {}
			}
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	platform.kill('SIGTERM');
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
			body: JSON.stringify({ id, email: `capacity-owner-${String(practice).padStart(2, '0')}@example.test`, password, email_confirm: true, role: 'authenticated' })
		});
		const user = await response.json().catch(() => null);
		if (!response.ok || user?.id !== id) throw new Error(`Could not create capacity owner ${practice} (HTTP ${response.status}).`);
		owners.push(id);
	}
	return owners;
}

async function scenario(practices) {
	const runId = randomUUID();
	environment.CITA_FIXTURE_RUN_ID = runId;
	let platform;
	try {
		await run('node', ['scripts/test-booking-foundation.mjs', '--keep', '--prepare-only']);
		const database = JSON.parse(readFileSync(fixturePath('database.json'), 'utf8')).container;
		if (!/^cita-booking-test-[a-f0-9]{12}$/.test(database)) throw new Error('Invalid disposable database receipt.');
		const started = await services(database);
		platform = started.platform;
		const owners = await createOwners(started.runtime, practices, randomBytes(18).toString('base64url'));
		const seedStarted = performance.now();
		const output = psql(database, readFileSync(join(root, 'scripts/capacity/seed-practices.sql'), 'utf8'),
			{ practices: String(practices), owners: JSON.stringify(owners) });
		const seed = JSON.parse(output.split('\n').at(-1));
		seed.durationMs = Math.round(performance.now() - seedStarted);
		if (seed.practices !== practices || seed.patients !== 6000 * practices || seed.appointments !== 12000 * practices)
			throw new Error('The capacity seed does not match its scenario: ' + JSON.stringify(seed));
		const result = { practices, seed };
		writeFileSync(join(evidence, `scenario-${practices}.json`), JSON.stringify(result, null, 2) + '\n');
		console.log('capacity-scenario ' + JSON.stringify(result));
		return result;
	} finally {
		if (platform) {
			platform.kill('SIGTERM');
			await new Promise(resolve => setTimeout(resolve, 2000));
		}
		cleanupFixtureResources(runId);
	}
}

try {
	const results = [];
	for (const practices of [5, 25]) results.push(await scenario(practices));
	const summary = { seedOnly, scenarios: results, scope: 'Disposable CI container (PostgreSQL 4 GB, 2 CPUs). Not hosted capacity.' };
	writeFileSync(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
	if (seedOnly) console.log('Seeding diagnostic completed; this is not a capacity result.');
} finally {
	lease.release();
}

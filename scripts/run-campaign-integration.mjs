import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixturePath } from './lib/fixture-path.mjs';
import { acquireVerificationLock } from './lib/verification-lock.mjs';
import { assertBrowserReport } from './lib/browser-report.mjs';
import { cleanupFixtureResources } from './lib/fixture-cleanup.mjs';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const diagnostic = process.argv[2] === '--grep' ? process.argv[3] : null;
if (process.argv.length !== 2 && !(process.argv.length === 4 && diagnostic))
	throw new Error('Usage: run-campaign-integration.mjs [--grep diagnostic-pattern]. Filtered execution never counts as full verification.');
assertHostedIntegrationResources();
const lease = acquireVerificationLock(root);
let platform;
let platformExit;
let database;
let activeCommand;
let interrupted = false;
const runId = randomUUID();
process.env.CITA_FIXTURE_RUN_ID = runId;
const campaignId = process.env.CITA_VERIFICATION_RUN_ID ?? runId;
if (!/^[a-f0-9-]{36}$/.test(campaignId)) throw new Error('Invalid campaign evidence identifier.');
const evidence = join(root, '.verification', 'runs', campaignId, diagnostic ? 'diagnostic-' + runId : 'integration');
mkdirSync(evidence, { recursive: true });
writeFileSync(join(root, '.verification', 'latest-integration.json'), JSON.stringify({ runId, campaignId, directory: evidence, diagnostic: Boolean(diagnostic) }, null, 2) + '\n');

async function run(command, args, options = {}) {
	if (interrupted) throw new Error('Verification interrupted.');
	activeCommand = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit', detached: true, ...options });
	const result = await new Promise(resolve => {
		activeCommand.once('error', error => resolve({ error }));
		activeCommand.once('exit', (status, signal) => resolve({ status, signal }));
	});
	activeCommand = undefined;
	if (interrupted || result.error || result.status !== 0)
		throw new Error(`${command} ${args[0]} failed (${result.status ?? result.signal ?? 'start error'}).`, { cause: result.error });
}

function cleanupDatabase() {
  try { cleanupFixtureResources(runId); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
	interrupted = true;
	if (activeCommand) try { process.kill(-activeCommand.pid, 'SIGTERM'); } catch {}
	if (platform) platform.kill('SIGTERM');
});

try {
	if (!diagnostic) await run('pnpm', ['--filter', 'natalia', 'build'], { env: {
		...process.env, ASTRO_TELEMETRY_DISABLED: '1', NATALIA_LOCAL_FIXTURE: 'true',
		PUBLIC_CITA_BASE_URL: 'http://127.0.0.1:5177', PUBLIC_NATALIA_INTEGRATION_KEY: 'ab'.repeat(16)
	} });
	await run('node', ['scripts/test-booking-foundation.mjs', '--real-storage', '--keep', ...(diagnostic ? ['--prepare-only'] : [])]);
	const prepared = JSON.parse(readFileSync(fixturePath('database.json'), 'utf8'));
	if (!diagnostic && !prepared.sqlVerified) throw new Error('Full integration requires actual SQL and concurrency verification.');
	database = prepared.container;
	if (!/^cita-booking-test-[a-f0-9]{12}$/.test(database)) throw new Error('Invalid disposable database receipt.');
	const log = openSync(join(evidence, 'platform.log'), 'w', 0o600);
	platform = spawn('node', ['scripts/serve-booking-fixture.mjs', database, '--real-auth'], {
		cwd: root, env: process.env, stdio: ['ignore', log, log]
	});
	platform.on('exit', (code, signal) => { platformExit = { code, signal }; });
	let runtime;
	for (let attempt = 0; attempt < 180; attempt++) {
		if (platformExit) throw new Error('Isolated platform exited. Read platform.log in the latest integration evidence directory.');
		if (existsSync(fixturePath('runtime.json'))) {
			const candidate = JSON.parse(readFileSync(fixturePath('runtime.json'), 'utf8'));
			if (candidate.container === database && candidate.realAuth) {
				try {
					const response = await fetch(candidate.appOrigin + '/embed/v1/' + candidate.key, { signal: AbortSignal.timeout(1000) });
					if (response.ok) { runtime = candidate; break; }
				} catch {}
			}
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	if (!runtime) throw new Error('Isolated app did not become ready; browser tests were not run.');
	for (const origin of [runtime.apiOrigin, runtime.appOrigin])
		if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Remote integration targets are forbidden.');
	const auth = await fetch(runtime.apiOrigin + '/auth/v1/user', { headers: { authorization: 'Bearer ' + runtime.ownerToken, apikey: runtime.anon }, signal: AbortSignal.timeout(5000) });
	const identity = await auth.json();
	if (!auth.ok || identity.id !== '90000000-0000-4000-8000-000000000004' || identity.role !== 'authenticated')
		throw new Error('Real Auth identity and authenticated role were not verified.');
	const membership = await fetch(runtime.apiOrigin + '/rest/v1/business_users?select=business_id&business_id=eq.' + runtime.businessId + '&user_id=eq.' + identity.id,
		{ headers: { authorization: 'Bearer ' + runtime.ownerToken, apikey: runtime.anon }, signal: AbortSignal.timeout(5000) });
	const memberships = await membership.json();
	if (!membership.ok || !Array.isArray(memberships) || memberships.length !== 1)
		throw new Error(`Authenticated RLS membership was not verified (HTTP ${membership.status}, rows ${Array.isArray(memberships) ? memberships.length : 'invalid'}).`);
	await run('node', ['scripts/generate-database-types.mjs', '--check']);
	const address = spawnSync('docker', ['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', database], { encoding: 'utf8' });
	// Inspect the specific network: concatenating addresses of a multi-network container is invalid.
	const details = spawnSync('docker', ['inspect', database], { encoding: 'utf8' });
	if (address.status || details.status) throw new Error('Could not inspect own database.');
	const ip = JSON.parse(details.stdout)[0].NetworkSettings.Networks[database + '-net'].IPAddress;
	const env = {
		...process.env, CI: 'true', CITA_E2E_ENVIRONMENT: 'disposable', E2E_BASE_URL: runtime.appOrigin, E2E_ALLOW_DESTRUCTIVE: 'true',
		E2E_LOCAL_BOOKING_FIXTURE_PATH: fixturePath('runtime.json'), DEMO_MODE: 'false',
		ODONTO_SUPABASE_URL: runtime.apiOrigin, PUBLIC_ODONTO_SUPABASE_URL: runtime.apiOrigin,
		ODONTO_SUPABASE_ANON_KEY: runtime.anon, PUBLIC_ODONTO_SUPABASE_ANON_KEY: runtime.anon,
		ODONTO_SUPABASE_SERVICE_ROLE_KEY: runtime.service,
		SUPABASE_DB_URL: `postgresql://supabase_admin:cita-disposable-test-only@${ip}:5432/postgres`,
		ADMIN_SUPABASE_URL: '', ADMIN_SUPABASE_ANON_KEY: '', ADMIN_SUPABASE_SERVICE_ROLE_KEY: '',
		E2E_EMAIL: 'e2e-owner@example.test', CITA_SUITE_TEST_EMAIL: 'e2e-owner@example.test',
		E2E_PASSWORD: 'CitaFixtureLocal!2026', CITA_SUITE_TEST_PASSWORD: 'CitaFixtureLocal!2026',
		CITA_SUITE_TEST_BUSINESS_ID: runtime.businessId, MASTER_EMAIL: 'master@cita-suite-test.local',
		E2E_MASTER_PASSWORD: 'E2eMasterLocal!2026', PUBLIC_SITE_URL: runtime.appOrigin,
		MP_ACCESS_TOKEN: '', MP_WEBHOOK_SECRET: '', E2E_VALIDATE_MP_REDIRECT: 'false',
		PLAYWRIGHT_JSON_OUTPUT_NAME: join(evidence, diagnostic ? 'browser-diagnostic.json' : 'browser.json'),
		PLAYWRIGHT_OUTPUT_DIR: join(evidence, 'browser-artifacts')
	};
	// Local production-mode coverage. Demo and real external OAuth require distinct
	// profiles; they must be reported separately, never counted as local passes.
	await run('pnpm', ['exec', 'playwright', 'test', '--workers=1', '--max-failures=1', '--retries=0', '--forbid-only', '--reporter=line,json',
		'--grep-invert', 'Reserva pública - modo demo|Google Auth', ...(diagnostic ? ['--grep', diagnostic] : [])],
		{ cwd: join(root, 'apps/web'), env });
	const report = JSON.parse(readFileSync(env.PLAYWRIGHT_JSON_OUTPUT_NAME, 'utf8'));
	assertBrowserReport(report);
	if (diagnostic) console.log('Diagnostic selection passed; this is not full integration verification.');
	else {
		// These are independent functional profiles, not a load test. Reset only
		// synthetic attempts in the owned tenant between profiles. Limits remain
		// unchanged and active throughout each profile and all capacity tests.
		const reset = spawnSync('docker', ['exec', '-i', database, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
			{ input: `delete from public.public_booking_attempts where business_id='${runtime.businessId}';`, encoding: 'utf8' });
		if (reset.status !== 0) throw new Error('Could not isolate synthetic attempt history between browser profiles.');
		await run('node', ['scripts/qa-natalia-direct-booking.mjs']);
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
} finally {
	if (platform && !platformExit) {
		platform.kill('SIGTERM');
		await Promise.race([new Promise(resolve => platform.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
		if (!platformExit) { platform.kill('SIGKILL'); process.exitCode = 1; }
	}
	// These logs belong to this run's labelled database. Preserve them even
	// when a page fails; never take another run's last temporary log instead.
	try {
		for (const name of ['vite', 'vite-errors']) {
			const source = fixturePath(`${name}-${runId}.log`);
			if (existsSync(source)) copyFileSync(source, join(evidence, `${name}.log`));
		}
		const state = fixturePath(`platform-state-${runId}.json`);
		if (existsSync(state)) copyFileSync(state, join(evidence, 'platform-state.json'));
	} catch {
		console.error('Could not preserve this run\'s application diagnostics.');
		process.exitCode = 1;
	}
	cleanupDatabase();
	lease.release();
}

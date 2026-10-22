import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function inspectOwnedFixture(receipt) {
	if (!/^cita-booking-test-[a-f0-9]{12}$/.test(receipt.container) || !/^[a-f0-9-]{32,36}$/.test(receipt.runId) ||
		![receipt.appOrigin, receipt.apiOrigin, receipt.hostOrigin].every(value => typeof value === 'string' && new URL(value).hostname === '127.0.0.1'))
		throw new Error('Only an owned loopback fixture is accepted.');
	const inspected = spawnSync('docker', ['inspect', receipt.container], { encoding: 'utf8' });
	if (inspected.status !== 0) throw new Error('The owned E2E database is not running.');
	const container = JSON.parse(inspected.stdout)[0];
	if (container.Config.Labels['com.cita-suite.booking-fixture'] !== 'true' || container.Config.Labels['com.cita-suite.fixture-run'] !== receipt.runId)
		throw new Error('E2E database ownership could not be verified.');
	return container;
}

export function assertE2EEnvironment(env, baseURL) {
	const mode = env.CITA_E2E_ENVIRONMENT;
	const app = new URL(baseURL);
	const local = url => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
	if (mode === 'demo') {
		if (env.DEMO_MODE !== 'true' || !local(app)) throw new Error('Demo E2E requires a local demo server.');
		return;
	}
	if (!env.ODONTO_SUPABASE_URL) throw new Error('Prepare an isolated E2E target; production .env fallbacks are forbidden.');
	const api = new URL(env.ODONTO_SUPABASE_URL);
	if (mode === 'disposable') {
		const receipt = JSON.parse(readFileSync(env.E2E_LOCAL_BOOKING_FIXTURE_PATH, 'utf8'));
		if (!local(app) || !local(api) || app.origin !== receipt.appOrigin || api.origin !== receipt.apiOrigin ||
			receipt.runId !== env.CITA_FIXTURE_RUN_ID || !/^cita-booking-test-[a-f0-9]{12}$/.test(receipt.container))
			throw new Error('E2E target does not match its owned disposable fixture.');
		const container = inspectOwnedFixture(receipt);
		const sql = new URL(env.SUPABASE_DB_URL);
		const addresses = Object.values(container.NetworkSettings.Networks).map(network => network.IPAddress);
		if (!addresses.includes(sql.hostname) || sql.port !== '5432' || sql.pathname !== '/postgres')
			throw new Error('E2E SQL access must target the inspected disposable container.');
		return;
	}
	if (mode === 'supabase-local') {
		if (!local(app) || !local(api) || !env.SUPABASE_DB_URL || !local(new URL(env.SUPABASE_DB_URL)) || env.E2E_ALLOW_DESTRUCTIVE !== 'true')
			throw new Error('Supabase local E2E requires explicit loopback targets and destructive-fixture opt-in.');
		return;
	}
	throw new Error('Select a verified isolated E2E environment; use pnpm verify:full. Production tests are forbidden during this campaign.');
}

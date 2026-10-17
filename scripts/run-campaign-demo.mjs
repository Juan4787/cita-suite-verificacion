import { spawn } from 'node:child_process';
import { assertRuntimeDiagnostics } from './lib/platform-diagnostics.mjs';
import { mkdtempSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireVerificationLock } from './lib/verification-lock.mjs';
import { assertBrowserReport } from './lib/browser-report.mjs';
import { randomUUID } from 'node:crypto';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
assertHostedIntegrationResources();
const lease = acquireVerificationLock(root);
const directory = mkdtempSync(join(tmpdir(), 'cita-demo-verification-'));
const campaignId = process.env.CITA_VERIFICATION_RUN_ID ?? randomUUID();
if (!/^[a-f0-9-]{36}$/.test(campaignId)) throw new Error('Invalid campaign evidence identifier.');
const evidence = join(root, '.verification', 'runs', campaignId, 'demo');
mkdirSync(evidence, { recursive: true });
const log = openSync(join(evidence, 'demo-platform.log'), 'w', 0o600);
const origin = 'http://127.0.0.1:5179';
const env = {
	...process.env, CI: 'true', CITA_E2E_ENVIRONMENT: 'demo', DEMO_MODE: 'true', DEMO_DB_PATH: join(directory, 'demo.json'),
	E2E_BASE_URL: origin, PUBLIC_SITE_URL: origin,
	ODONTO_SUPABASE_URL: 'http://127.0.0.1:1', ODONTO_SUPABASE_ANON_KEY: '', ODONTO_SUPABASE_SERVICE_ROLE_KEY: '',
	PUBLIC_ODONTO_SUPABASE_URL: 'http://127.0.0.1:1', PUBLIC_ODONTO_SUPABASE_ANON_KEY: '',
	ADMIN_SUPABASE_URL: '', ADMIN_SUPABASE_ANON_KEY: '', ADMIN_SUPABASE_SERVICE_ROLE_KEY: '',
	MP_ACCESS_TOKEN: '', MP_WEBHOOK_SECRET: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
	PLAYWRIGHT_JSON_OUTPUT_NAME: join(evidence, 'browser-demo.json'),
	PLAYWRIGHT_OUTPUT_DIR: join(evidence, 'browser-artifacts')
};
const app = spawn('pnpm', ['--filter', 'web', 'dev', '--host', '127.0.0.1', '--port', '5179', '--strictPort'],
	{ cwd: root, env, detached: true, stdio: ['ignore', log, log] });
let appExit;
let browser;
app.on('exit', (status, signal) => { appExit = { status, signal }; });
function terminate(child) { if (child?.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { terminate(browser); terminate(app); process.exitCode = 1; });
try {
	let ready = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (appExit) throw new Error('Demo server exited before readiness.');
		try { if ((await fetch(origin + '/reservar/consultorio-demo', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	if (!ready) throw new Error('Demo server did not become ready.');
	browser = spawn('pnpm', ['exec', 'playwright', 'test', 'odonto.smoke.spec.ts', '--grep', 'Reserva pública - modo demo',
		'--workers=1', '--retries=0', '--max-failures=1', '--forbid-only', '--reporter=line,json'],
		{ cwd: join(root, 'apps/web'), env, stdio: 'inherit', detached: true });
	const result = await new Promise(resolve => {
		browser.once('error', error => resolve({ error }));
		browser.once('exit', (status, signal) => resolve({ status, signal }));
	});
	if (result.error || result.status !== 0) throw new Error('Demo browser profile failed.');
	const report = JSON.parse(readFileSync(env.PLAYWRIGHT_JSON_OUTPUT_NAME, 'utf8'));
	assertBrowserReport(report);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
} finally {
	terminate(browser);
	terminate(app);
	if (!appExit) await new Promise(resolve => app.once('exit', resolve));
	try { assertRuntimeDiagnostics(readFileSync(join(evidence, 'demo-platform.log'), 'utf8')); }
	catch (error) { console.error(error.message); process.exitCode = 1; }
	rmSync(directory, { recursive: true });
	lease.release();
}

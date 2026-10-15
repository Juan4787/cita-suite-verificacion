import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStagingEnvironment } from './lib/staging-environment.mjs';
import { assertBrowserReport } from './lib/browser-report.mjs';

// Explicit opt-in only: never load staging credentials from the production .env.
const root = fileURLToPath(new URL('../', import.meta.url));
const { descriptor, app, natalia, api } = loadStagingEnvironment(root, process.env);
const builtVersion = JSON.parse(readFileSync(join(root, 'apps/web/.svelte-kit/output/client/_app/version.json'), 'utf8')).version;
if (builtVersion !== descriptor.revision) throw new Error('The built artifact does not match the staging revision.');

async function get(url) {
	const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
	if (!response.ok) throw new Error('Staging HTTP verification failed: ' + response.status);
	return response;
}

const deployedVersion = await (await get(app.origin + '/_app/version.json')).json();
if (deployedVersion.version !== builtVersion) throw new Error('Staging serves a different app revision.');
await get(app.origin + '/login');
await get(natalia.origin + '/');
if (!Array.isArray(descriptor.nataliaAssets) || !descriptor.nataliaAssets.length)
	throw new Error('Natalia must have a manifest of actual built asset hashes.');
for (const asset of descriptor.nataliaAssets) {
	if (!/^\/[a-zA-Z0-9_./-]+$/.test(asset.path) || asset.path.includes('..') || !/^[a-f0-9]{64}$/.test(asset.sha256))
		throw new Error('Invalid Natalia asset manifest.');
	const localArtifact = readFileSync(join(root, 'apps/natalia/dist', asset.path));
	if (createHash('sha256').update(localArtifact).digest('hex') !== asset.sha256)
		throw new Error('Natalia manifest does not match the locally built artifact.');
	const response = await get(natalia.origin + asset.path);
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > 5_000_000) { await reader.cancel(); throw new Error('Staging asset exceeded its bounded verification size.'); }
		chunks.push(value);
	}
	if (createHash('sha256').update(Buffer.concat(chunks)).digest('hex') !== asset.sha256)
		throw new Error('Natalia serves an asset different from the reviewed artifact.');
}

const directory = join(root, '.verification');
mkdirSync(directory, { recursive: true });
const reportPath = join(directory, 'browser-staging.json');
const env = {
	...process.env, CI: 'true', CITA_E2E_ENVIRONMENT: 'isolated-staging', DEMO_MODE: 'false', E2E_BASE_URL: app.origin,
	PUBLIC_SITE_URL: app.origin, ODONTO_SUPABASE_URL: api.origin, PUBLIC_ODONTO_SUPABASE_URL: api.origin,
	ODONTO_SUPABASE_ANON_KEY: process.env.CITA_STAGING_ANON_KEY,
	PUBLIC_ODONTO_SUPABASE_ANON_KEY: process.env.CITA_STAGING_ANON_KEY,
	ODONTO_SUPABASE_SERVICE_ROLE_KEY: process.env.CITA_STAGING_SERVICE_ROLE_KEY,
	SUPABASE_DB_URL: process.env.CITA_STAGING_DATABASE_URL,
	E2E_ALLOW_DESTRUCTIVE: 'true', E2E_ALLOW_PRODUCTION_CLINICAL: 'true',
	E2E_EMAIL: descriptor.testEmail, CITA_SUITE_TEST_EMAIL: descriptor.testEmail,
	E2E_PASSWORD: process.env.CITA_STAGING_TEST_PASSWORD, CITA_SUITE_TEST_PASSWORD: process.env.CITA_STAGING_TEST_PASSWORD,
	CITA_SUITE_TEST_BUSINESS_ID: descriptor.syntheticBusinessId,
	MASTER_EMAIL: descriptor.masterEmail, E2E_MASTER_PASSWORD: process.env.CITA_STAGING_MASTER_PASSWORD,
	ADMIN_SUPABASE_URL: '', ADMIN_SUPABASE_ANON_KEY: '', ADMIN_SUPABASE_SERVICE_ROLE_KEY: '',
	MP_ACCESS_TOKEN: '', MP_WEBHOOK_SECRET: '', E2E_VALIDATE_MP_REDIRECT: 'false', E2E_CLOUDFLARE_VERSION: '',
	E2E_LOCAL_BOOKING_FIXTURE_PATH: '', PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath
};
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '--workers=1', '--retries=0', '--max-failures=1', '--forbid-only', '--reporter=line,json',
	'--grep-invert', 'isolated booking integration|Reserva pública - modo demo|Google Auth real'],
	{ cwd: join(root, 'apps/web'), env, stdio: 'inherit' });
if (result.error || result.status !== 0) throw new Error('Staging browser coverage failed.');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assertBrowserReport(report);
writeFileSync(join(directory, 'staging.json'), JSON.stringify({
	scope: 'Dedicated staging; external Google-account login is not certified by this profile.',
	revision: descriptor.revision, appOrigin: app.origin, nataliaOrigin: natalia.origin,
	passed: report.stats.expected, finishedAt: new Date().toISOString()
}, null, 2) + '\n');

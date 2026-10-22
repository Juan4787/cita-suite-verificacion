import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	STAGING_APP_WORKER, assertBuildArtifact, assertStagingAppConfig, assertStagingSchedulerConfig, loadBuildArtifact, stagingAppSecrets, stagingSupabaseKey
} from './staging-deploy.mjs';

const read = path => JSON.parse(readFileSync(fileURLToPath(new URL('../../' + path, import.meta.url)), 'utf8'));
const stagingApp = read('apps/web/wrangler.staging.jsonc');
const scheduler = read('apps/scheduler/wrangler.jsonc');
const jwt = claims => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'SIGNATURE_SENTINEL'].join('.');
const keys = (ref = 'ikaudqoilclfnztkxubz') => [
	{ name: 'anon', type: 'legacy', api_key: jwt({ ref, role: 'anon' }) },
	{ name: 'service_role', type: 'legacy', api_key: jwt({ ref, role: 'service_role' }) },
	{ name: 'default', type: 'secret', api_key: 'sb_secret_SENTINEL' }
];
const workerSecrets = { VAPID_PUBLIC_KEY: 'B'.repeat(87), PUBLIC_VAPID_PUBLIC_KEY: 'B'.repeat(87), VAPID_PRIVATE_KEY: 'p'.repeat(43), INTERNAL_JOB_SECRET: 'a'.repeat(64) };

test('the staging app configuration is accepted and production or altered targets are refused', () => {
	assert.equal(assertStagingAppConfig(stagingApp).name, STAGING_APP_WORKER);
	for (const config of [
		read('apps/web/wrangler.jsonc'),
		{ ...stagingApp, name: 'app' },
		{ ...stagingApp, account_id: 'fc592fdc570803acbf4b523d106e446e' },
		{ ...stagingApp, vars: { ...stagingApp.vars, ODONTO_SUPABASE_URL: 'https://yjzferwuzbtgpmdnzlcb.supabase.co' } },
		{ ...stagingApp, vars: { ...stagingApp.vars, PUBLIC_SITE_URL: 'https://app.cita-suite.workers.dev' } },
		{ ...stagingApp, routes: [{ pattern: 'cita-suite.example/*' }] },
		{ ...stagingApp, triggers: { crons: ['*/5 * * * *'] } },
		{ ...stagingApp, env: { production: { name: 'app' } } },
		{ ...stagingApp, workers_dev: false }
	]) assert.throws(() => assertStagingAppConfig(config), /not the staging target/);
});

test('only the staging environment of the scheduler, bound to the staging app with the plan crons, is accepted', () => {
	assert.equal(assertStagingSchedulerConfig(scheduler).name, 'cita-suite-scheduler-staging');
	const staging = scheduler.env.staging;
	for (const config of [
		{ ...scheduler, env: {} },
		{ ...scheduler, env: { staging: { ...staging, services: [{ binding: 'APP', service: 'app' }] } } },
		{ ...scheduler, env: { staging: { ...staging, name: 'cita-suite-scheduler' } } },
		{ ...scheduler, env: { staging: { ...staging, triggers: { crons: staging.triggers.crons.slice(1) } } } },
		{ ...scheduler, env: { staging: { ...staging, routes: ['cita-suite.example/*'] } } },
		{ ...scheduler, account_id: 'fc592fdc570803acbf4b523d106e446e' },
		{ ...scheduler, workers_dev: true }
	]) assert.throws(() => assertStagingSchedulerConfig(config), /not the staging target/);
});

test('Supabase keys must name the staging project and their role, and errors never show a key', () => {
	assert.equal(stagingSupabaseKey(keys(), 'anon'), keys()[0].api_key);
	assert.equal(stagingSupabaseKey(keys(), 'service_role'), keys()[1].api_key);
	for (const [entries, role] of [[keys('yjzferwuzbtgpmdnzlcb'), 'service_role'], [keys('yjzferwuzbtgpmdnzlcb'), 'anon'],
		[[{ name: 'anon', type: 'legacy', api_key: jwt({ ref: 'ikaudqoilclfnztkxubz', role: 'service_role' }) }], 'anon'],
		[[{ name: 'anon', type: 'legacy', api_key: 'not.a.SIGNATURE_SENTINEL' }], 'anon'], [[], 'anon'], [null, 'anon']]) {
		assert.throws(() => stagingSupabaseKey(entries, role), error =>
			/does not belong to the staging project/.test(error.message) && !/SENTINEL|eyJ/.test(error.message));
	}
});

test('the app secrets are complete, consistent and malformed private files are refused', () => {
	assert.deepEqual(Object.keys(stagingAppSecrets(workerSecrets, keys())).sort(), [
		'INTERNAL_JOB_SECRET', 'ODONTO_SUPABASE_ANON_KEY', 'ODONTO_SUPABASE_SERVICE_ROLE_KEY', 'PUBLIC_ODONTO_SUPABASE_ANON_KEY',
		'PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY']);
	for (const secrets of [{ ...workerSecrets, PUBLIC_VAPID_PUBLIC_KEY: 'C'.repeat(87) }, { ...workerSecrets, VAPID_PRIVATE_KEY: '' },
		{ ...workerSecrets, INTERNAL_JOB_SECRET: 'short' }, { ...workerSecrets, VAPID_PUBLIC_KEY: undefined, PUBLIC_VAPID_PUBLIC_KEY: undefined }])
		assert.throws(() => stagingAppSecrets(secrets, keys()), /incomplete or malformed/);
	assert.throws(() => stagingAppSecrets(workerSecrets, keys('yjzferwuzbtgpmdnzlcb')), /does not belong to the staging project/);
});

test('the downloaded build must match its manifest exactly and keep the server bundle out of the assets', () => {
	const revision = 'a'.repeat(40);
	const build = () => new Map([
		['.verification/cloudflare-bundle/_worker.js', Buffer.from('export default {}')],
		['apps/web/.svelte-kit/cloudflare/.assetsignore', Buffer.from('\n_worker.js\n_routes.json')],
		['apps/web/.svelte-kit/cloudflare/_app/version.json', Buffer.from(JSON.stringify({ version: revision }))]
	]);
	const manifestOf = files => ({ revision, version: revision, files: [...files].map(([path, contents]) =>
		({ path, bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') })) });
	assert.equal(assertBuildArtifact(manifestOf(build()), build()), revision);
	const extra = build().set('apps/web/.svelte-kit/cloudflare/extra.js', Buffer.from('x'));
	const changed = build().set('.verification/cloudflare-bundle/_worker.js', Buffer.from('export default {fetch(){}}'));
	const missing = build(); missing.delete('apps/web/.svelte-kit/cloudflare/_app/version.json');
	const exposed = build().set('apps/web/.svelte-kit/cloudflare/.assetsignore', Buffer.from('_routes.json'));
	assert.throws(() => assertBuildArtifact(manifestOf(build()), extra), /exactly the files/);
	assert.throws(() => assertBuildArtifact(manifestOf(build()), changed), /differs from its manifest/);
	assert.throws(() => assertBuildArtifact(manifestOf(build()), missing), /exactly the files/);
	assert.throws(() => assertBuildArtifact(manifestOf(exposed), exposed), /publish the server bundle/);
	assert.throws(() => assertBuildArtifact({ ...manifestOf(build()), version: 'b'.repeat(40) }, build()), /one exact revision/);
	const withoutBundle = build(); withoutBundle.delete('.verification/cloudflare-bundle/_worker.js');
	assert.throws(() => assertBuildArtifact(manifestOf(withoutBundle), withoutBundle), /lacks/);
});

test('a downloaded build is read whole from disk, and a link inside it is refused', () => {
	const revision = 'a'.repeat(40);
	const directory = mkdtempSync(join(tmpdir(), 'cita-build-'));
	try {
		const files = { '.verification/cloudflare-bundle/_worker.js': 'export default {}', 'apps/web/.svelte-kit/cloudflare/.assetsignore': '_worker.js\n' };
		for (const [path, contents] of Object.entries(files)) {
			mkdirSync(dirname(join(directory, path)), { recursive: true });
			writeFileSync(join(directory, path), contents);
		}
		writeFileSync(join(directory, '.verification/cloudflare-bundle-manifest.json'), JSON.stringify({ revision, version: revision,
			files: Object.entries(files).map(([path, contents]) => ({ path, bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') })) }));
		const loaded = loadBuildArtifact(directory);
		assert.equal(loaded.revision, revision);
		assert.deepEqual([...loaded.files.keys()].sort(), Object.keys(files).sort());
		symlinkSync('/etc/hostname', join(directory, 'apps/web/.svelte-kit/cloudflare/linked'));
		assert.throws(() => loadBuildArtifact(directory), /contains a link/);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

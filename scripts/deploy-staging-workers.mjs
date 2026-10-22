import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CLOUDFLARE_ACCOUNT_ID, STAGING_APP_ORIGIN, STAGING_NATALIA_ORIGIN, STAGING_NATALIA_WORKER, STAGING_RELEASE_PRACTICE,
	assertStagingAppConfig, assertStagingSchedulerConfig, loadBuildArtifact, nataliaSite, stagingAppSecrets
} from './lib/staging-deploy.mjs';

// Deploys the staging Workers only. The app and Natalia's staging copy are uploaded exactly
// as the staging workflow built them (no local build); the scheduler's staging environment must
// match the last verified source snapshot. Secrets come from the private files
// outside the repository and travel in a temporary file readable only by this user.
const root = fileURLToPath(new URL('../', import.meta.url));
const [target, artifactArgument] = process.argv.slice(2);
if (!['app', 'natalia', 'scheduler', 'scheduler-without-crons'].includes(target) || ['app', 'natalia'].includes(target) !== Boolean(artifactArgument) ||
	process.argv.length > 4)
	throw new Error('Usage: deploy-staging-workers.mjs app|natalia <downloaded build directory> | scheduler | scheduler-without-crons');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const privateDirectory = join(homedir(), '.config/cita-suite/staging');
const workerSecrets = readJson(join(privateDirectory, 'worker-secrets.json'));

function deploy(workspace, config, args, secrets) {
	const temporary = mkdtempSync(join(tmpdir(), 'cita-staging-deploy-'));
	try {
		const secretArgs = [];
		if (secrets) {
			writeFileSync(join(temporary, 'secrets.json'), JSON.stringify(secrets), { mode: 0o600 });
			secretArgs.push('--secrets-file', join(temporary, 'secrets.json'));
		}
		const configArgs = config ? ['--config', join(temporary, 'wrangler.json')] : [];
		if (config) writeFileSync(join(temporary, 'wrangler.json'), JSON.stringify(typeof config === 'function' ? config(temporary) : config, null, 2));
		const result = spawnSync('pnpm', ['--filter', workspace, 'exec', 'wrangler', 'deploy', ...configArgs, ...args, ...secretArgs, '--strict'],
			{ cwd: root, stdio: 'inherit', timeout: 600_000 });
		if (result.status !== 0) throw new Error(`The staging deployment of ${workspace} failed.`);
	} finally { rmSync(temporary, { recursive: true, force: true }); }
}

// A deployment propagates within seconds; the served file must be the one uploaded.
async function served(url, expected, label) {
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(url).catch(() => null);
		const body = response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
		if (body && expected(body)) return;
		if (attempt === 12) throw new Error(`Staging does not serve the uploaded ${label}.`);
		await new Promise(done => setTimeout(done, 5_000));
	}
}

if (target === 'natalia') {
	const { revision, files } = loadBuildArtifact(resolve(artifactArgument));
	const site = nataliaSite(files, 'natalia-staging', { base: STAGING_APP_ORIGIN, key: STAGING_RELEASE_PRACTICE.integrationKey });
	const app = readJson(join(root, 'apps/web/wrangler.staging.jsonc'));
	// Assets only, no code. The copy stays out of search engines: it repeats a published site.
	deploy('web', temporary => {
		for (const [path, contents] of site) {
			mkdirSync(dirname(join(temporary, 'site', path)), { recursive: true });
			writeFileSync(join(temporary, 'site', path), contents);
		}
		writeFileSync(join(temporary, 'site/_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
		return { name: STAGING_NATALIA_WORKER, account_id: CLOUDFLARE_ACCOUNT_ID, compatibility_date: app.compatibility_date,
			assets: { directory: join(temporary, 'site') }, workers_dev: true, preview_urls: false };
	}, ['--message', `Natalia staging ${revision}`]);
	const home = createHash('sha256').update(site.get('index.html')).digest('hex');
	await served(`${STAGING_NATALIA_ORIGIN}/`, body => createHash('sha256').update(body).digest('hex') === home, 'page of Natalia');
	console.log(JSON.stringify({ deployed: 'natalia', revision, origin: STAGING_NATALIA_ORIGIN, files: site.size }));
} else if (target === 'app') {
	const { revision } = loadBuildArtifact(resolve(artifactArgument));
	const artifact = resolve(artifactArgument);
	const { $schema, ...config } = assertStagingAppConfig(readJson(join(root, 'apps/web/wrangler.staging.jsonc')));
	deploy('web', {
		...config,
		main: join(artifact, '.verification/cloudflare-bundle/_worker.js'),
		no_bundle: true,
		assets: { ...config.assets, directory: join(artifact, 'apps/web/.svelte-kit/cloudflare') }
	}, ['--message', `Cita Suite ${revision}`], stagingAppSecrets(workerSecrets, readJson(join(privateDirectory, 'api-keys.json'))));
	// The served build names its revision.
	await served(`${STAGING_APP_ORIGIN}/_app/version.json`, body => { try { return JSON.parse(body).version === revision; } catch { return false; } }, `revision ${revision}`);
	console.log(JSON.stringify({ deployed: 'app', revision, origin: STAGING_APP_ORIGIN }));
} else {
	const schedulerConfig = readJson(join(root, 'apps/scheduler/wrangler.jsonc'));
	assertStagingSchedulerConfig(schedulerConfig);
	// The scheduler is bundled from the working tree: it must be the verified source.
	const snapshot = readJson(join(root, '.verification/ci-source.json'));
	const blob = contents => createHash('sha1').update(`blob ${contents.length}\0`).update(contents).digest('hex');
	const sources = snapshot.manifest.filter(({ path }) => path.startsWith('apps/scheduler/') || path === 'packages/shared/src/scheduled-jobs.ts');
	if (!sources.some(({ path }) => path === 'apps/scheduler/src/index.ts') ||
		sources.some(({ path, blob: expected }) => blob(readFileSync(join(root, path))) !== expected))
		throw new Error('The scheduler differs from the verified snapshot. Nothing was deployed.');
	// The Free account holds five crons: releasing them from staging lets the production
	// scheduler take them. The staging scheduler stays deployed, without triggers.
	const { $schema, ...scheduler } = schedulerConfig;
	const config = target === 'scheduler-without-crons'
		? { ...scheduler, main: join(root, 'apps/scheduler', scheduler.main), env: { ...scheduler.env, staging: { ...scheduler.env.staging, triggers: { crons: [] } } } }
		: null;
	deploy('scheduler', config, ['--env', 'staging', '--message', `Cita Suite scheduler ${snapshot.commit}${config ? ' without crons' : ''}`],
		{ INTERNAL_JOB_SECRET: stagingAppSecrets(workerSecrets, readJson(join(privateDirectory, 'api-keys.json'))).INTERNAL_JOB_SECRET });
	console.log(JSON.stringify({ deployed: target, snapshot: snapshot.commit }));
}

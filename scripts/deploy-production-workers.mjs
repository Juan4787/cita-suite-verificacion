import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBuildArtifact } from './lib/staging-deploy.mjs';
import {
	PRODUCTION_APP_ORIGIN, PRODUCTION_APP_WORKER, assertProductionAppConfig, assertProductionSchedulerConfig, assertProductionSchedulerAuthentication, missingSecrets
} from './lib/production-deploy.mjs';
import { productionEnvironment, productionPsql } from './lib/production-database.mjs';

// Deploys the production Workers. The app is the bundle the staging workflow built with the
// production configuration (.verification/cloudflare-bundle-production), uploaded as built:
// no local build. It never writes the app's secrets, and refuses to deploy when one the
// application needs is missing. The scheduler is bundled from the verified snapshot's source
// and receives the job secret from the private configuration, never from a log or the repository.
// `scheduler-without-crons` deploys it with no trigger: the first step of a rollback, which stops
// the new scheduler before anything else (docs/architecture/publicacion-y-reversion.md).
const root = fileURLToPath(new URL('../', import.meta.url));
const [target, artifactArgument] = process.argv.slice(2);
if (!['app', 'scheduler', 'scheduler-without-crons'].includes(target) || (target === 'app') !== Boolean(artifactArgument) || process.argv.length > 4)
	throw new Error('Usage: deploy-production-workers.mjs app <downloaded build directory> | scheduler | scheduler-without-crons');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, ''));

function wrangler(workspace, config, args, secrets) {
	const temporary = mkdtempSync(join(tmpdir(), 'cita-production-deploy-'));
	try {
		const configArgs = config ? ['--config', join(temporary, 'wrangler.json')] : [];
		if (config) writeFileSync(join(temporary, 'wrangler.json'), JSON.stringify(config, null, 2));
		const secretArgs = [];
		if (secrets) {
			writeFileSync(join(temporary, 'secrets.json'), JSON.stringify(secrets), { mode: 0o600 });
			secretArgs.push('--secrets-file', join(temporary, 'secrets.json'));
		}
		const result = spawnSync('pnpm', ['--filter', workspace, 'exec', 'wrangler', 'deploy', ...configArgs, ...args, ...secretArgs, '--strict'],
			{ cwd: root, stdio: 'inherit', timeout: 600_000 });
		if (result.status !== 0) throw new Error(`The production deployment of ${workspace} failed.`);
	} finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (target === 'app') {
	const artifact = resolve(artifactArgument);
	const { revision, files } = loadBuildArtifact(artifact);
	if (!files.has('.verification/cloudflare-bundle-production/_worker.js')) throw new Error('The build lacks the production bundle. Nothing was deployed.');
	const { $schema, ...config } = assertProductionAppConfig(readJson(join(root, 'apps/web/wrangler.jsonc')));
	const listed = spawnSync('pnpm', ['--filter', 'web', 'exec', 'wrangler', 'secret', 'list', '--name', PRODUCTION_APP_WORKER], { cwd: root, encoding: 'utf8', timeout: 120_000 });
	const names = JSON.parse(listed.stdout.slice(listed.stdout.indexOf('['))).map((secret) => secret.name);
	const missing = missingSecrets(names);
	if (listed.status !== 0 || missing.length) throw new Error(`Production lacks the secrets ${missing.join(', ')}. Nothing was deployed.`);
	wrangler('web', {
		...config,
		main: join(artifact, '.verification/cloudflare-bundle-production/_worker.js'),
		no_bundle: true,
		assets: { ...config.assets, directory: join(artifact, 'apps/web/.svelte-kit/cloudflare') }
	}, ['--message', `Cita Suite ${revision}`]);
	// The served build names its revision; propagation can take a few seconds.
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(`${PRODUCTION_APP_ORIGIN}/_app/version.json`).catch(() => null);
		const served = response?.ok ? (await response.json().catch(() => null))?.version : null;
		if (served === revision) break;
		if (attempt === 12) throw new Error(`Production serves ${served ?? 'no version'} instead of ${revision}.`);
		await new Promise((done) => setTimeout(done, 5_000));
	}
	console.log(JSON.stringify({ deployed: 'app', revision, origin: PRODUCTION_APP_ORIGIN }));
} else {
	const { $schema, ...scheduler } = assertProductionSchedulerConfig(readJson(join(root, 'apps/scheduler/wrangler.jsonc')));
	// The scheduler is bundled from the working tree: it must be the verified source.
	const snapshot = readJson(join(root, '.verification/ci-source.json'));
	const blob = (contents) => createHash('sha1').update(`blob ${contents.length}\0`).update(contents).digest('hex');
	const sources = snapshot.manifest.filter(({ path }) => path.startsWith('apps/scheduler/') || path === 'packages/shared/src/scheduled-jobs.ts');
	if (!sources.some(({ path }) => path === 'apps/scheduler/src/index.ts') ||
		sources.some(({ path, blob: expected }) => blob(readFileSync(join(root, path))) !== expected))
		throw new Error('The scheduler differs from the verified snapshot. Nothing was deployed.');
	const env = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split('\n')
		.map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter(Boolean)
		.map(([, key, value]) => [key, value.replace(/^["']|["']$/g, '')]));
	const secret = env.INTERNAL_JOB_SECRET ?? '';
	if (secret.length < 32 || /\s/.test(secret)) throw new Error('The production job secret is missing or malformed. Nothing was deployed.');
	if (target === 'scheduler') {
		const { database } = productionEnvironment(root);
		const legacy = productionPsql(database, 'begin transaction read only; select public.legacy_job_entrypoints_enabled(); commit;',
			{ application: 'cita_suite_scheduler_authentication_preflight' }).trim();
		const proof = await assertProductionSchedulerAuthentication({ secret, legacyEnabled: legacy === 'f' ? false : legacy === 't' ? true : null });
		console.log(JSON.stringify({ schedulerAuthenticationPreflight: proof }));
	}
	// Without crons, the same Worker and binding stay deployed and no event starts a job.
	const config = target === 'scheduler-without-crons'
		? { ...scheduler, main: join(root, 'apps/scheduler', scheduler.main), triggers: { crons: [] } }
		: null;
	wrangler('scheduler', config, ['--message', `Cita Suite scheduler ${snapshot.commit}${config ? ' without crons' : ''}`], { INTERNAL_JOB_SECRET: secret });
	console.log(JSON.stringify({ deployed: target, snapshot: snapshot.commit }));
}

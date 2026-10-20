import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	STAGING_APP_ORIGIN, assertBuildArtifact, assertStagingAppConfig, assertStagingSchedulerConfig, stagingAppSecrets
} from './lib/staging-deploy.mjs';

// Deploys the staging Workers only. The app is uploaded exactly as the staging
// workflow bundled it (no local build); the scheduler's staging environment must
// match the last verified source snapshot. Secrets come from the private files
// outside the repository and travel in a temporary file readable only by this user.
const root = fileURLToPath(new URL('../', import.meta.url));
const [target, artifactArgument] = process.argv.slice(2);
if (!['app', 'scheduler'].includes(target) || (target === 'app') !== Boolean(artifactArgument) || process.argv.length > 4)
	throw new Error('Usage: deploy-staging-workers.mjs app <downloaded build directory> | scheduler');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const privateDirectory = join(homedir(), '.config/cita-suite/staging');
const workerSecrets = readJson(join(privateDirectory, 'worker-secrets.json'));

function deploy(workspace, config, args, secrets) {
	const temporary = mkdtempSync(join(tmpdir(), 'cita-staging-deploy-'));
	try {
		const secretsFile = join(temporary, 'secrets.json');
		writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
		const configArgs = config ? ['--config', join(temporary, 'wrangler.json')] : [];
		if (config) writeFileSync(join(temporary, 'wrangler.json'), JSON.stringify(config, null, 2));
		const result = spawnSync('pnpm', ['--filter', workspace, 'exec', 'wrangler', 'deploy', ...configArgs, ...args, '--secrets-file', secretsFile, '--strict'],
			{ cwd: root, stdio: 'inherit', timeout: 600_000 });
		if (result.status !== 0) throw new Error(`The staging deployment of ${workspace} failed.`);
	} finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (target === 'app') {
	const artifact = resolve(artifactArgument);
	const files = new Map();
	const walk = directory => {
		for (const name of readdirSync(directory)) {
			const path = join(directory, name);
			const stat = lstatSync(path);
			if (stat.isSymbolicLink()) throw new Error('The downloaded build contains a link.');
			if (stat.isDirectory()) walk(path);
			else files.set(relative(artifact, path), readFileSync(path));
		}
	};
	walk(artifact);
	const manifestPath = '.verification/cloudflare-bundle-manifest.json';
	const manifest = JSON.parse(files.get(manifestPath)?.toString('utf8') ?? 'null');
	files.delete(manifestPath);
	const revision = assertBuildArtifact(manifest, files);
	const { $schema, ...config } = assertStagingAppConfig(readJson(join(root, 'apps/web/wrangler.staging.jsonc')));
	deploy('web', {
		...config,
		main: join(artifact, '.verification/cloudflare-bundle/_worker.js'),
		no_bundle: true,
		assets: { ...config.assets, directory: join(artifact, 'apps/web/.svelte-kit/cloudflare') }
	}, ['--message', `Cita Suite ${revision}`], stagingAppSecrets(workerSecrets, readJson(join(privateDirectory, 'api-keys.json'))));
	// The served build names its revision; propagation can take a few seconds.
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(`${STAGING_APP_ORIGIN}/_app/version.json`).catch(() => null);
		const served = response?.ok ? (await response.json().catch(() => null))?.version : null;
		if (served === revision) break;
		if (attempt === 12) throw new Error(`Staging serves ${served ?? 'no version'} instead of ${revision}.`);
		await new Promise(done => setTimeout(done, 5_000));
	}
	console.log(JSON.stringify({ deployed: 'app', revision, origin: STAGING_APP_ORIGIN }));
} else {
	assertStagingSchedulerConfig(readJson(join(root, 'apps/scheduler/wrangler.jsonc')));
	// The scheduler is bundled from the working tree: it must be the verified source.
	const snapshot = readJson(join(root, '.verification/ci-source.json'));
	const blob = contents => createHash('sha1').update(`blob ${contents.length}\0`).update(contents).digest('hex');
	const sources = snapshot.manifest.filter(({ path }) => path.startsWith('apps/scheduler/') || path === 'packages/shared/src/scheduled-jobs.ts');
	if (!sources.some(({ path }) => path === 'apps/scheduler/src/index.ts') ||
		sources.some(({ path, blob: expected }) => blob(readFileSync(join(root, path))) !== expected))
		throw new Error('The scheduler differs from the verified snapshot. Nothing was deployed.');
	deploy('scheduler', null, ['--env', 'staging', '--message', `Cita Suite scheduler ${snapshot.commit}`],
		{ INTERNAL_JOB_SECRET: stagingAppSecrets(workerSecrets, readJson(join(privateDirectory, 'api-keys.json'))).INTERNAL_JOB_SECRET });
	console.log(JSON.stringify({ deployed: 'scheduler', snapshot: snapshot.commit }));
}

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';
import { STAGING_APP_ORIGIN, STAGING_RELEASE_PRACTICE, assertBuildArtifact, nataliaSite } from './lib/staging-deploy.mjs';
import { PRODUCTION_APP_ORIGIN, PRODUCTION_NATALIA_INTEGRATION_KEY } from './lib/production-deploy.mjs';

// Builds the release once, in the hosted runner and never on this machine: the app for Cloudflare,
// bundled with the staging and the production configuration (the same code, only the configuration
// differs), and Natalia's static site for each environment. The manifest names every file with its
// size and digest; deployments and the release verification use these exact files, never a rebuild.
const root = fileURLToPath(new URL('../', import.meta.url));
assertHostedIntegrationResources();
const revision = process.env.CITA_BUILD_VERSION ?? '';
if (!/^[0-9a-f]{40}$/.test(revision) || process.argv.length !== 2) throw new Error('Usage: CITA_BUILD_VERSION=<revision> package-release-artifact.mjs');

function run(command, args, { cwd = root, env = {} } = {}) {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, timeout: 900_000 });
	if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed. Nothing was packaged.`);
}

const verification = join(root, '.verification');
for (const name of ['cloudflare-bundle', 'cloudflare-bundle-production', 'natalia-staging', 'natalia-production', 'cloudflare-bundle-manifest.json'])
	rmSync(join(verification, name), { recursive: true, force: true });
run('pnpm', ['--filter', 'web', 'build:cloudflare']);
run('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run', '--config', 'wrangler.staging.jsonc', '--outdir', join(verification, 'cloudflare-bundle')], { cwd: join(root, 'apps/web') });
run('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run', '--config', 'wrangler.jsonc', '--outdir', join(verification, 'cloudflare-bundle-production')], { cwd: join(root, 'apps/web') });
const natalia = { 'natalia-staging': { base: STAGING_APP_ORIGIN, key: STAGING_RELEASE_PRACTICE.integrationKey },
	'natalia-production': { base: PRODUCTION_APP_ORIGIN, key: PRODUCTION_NATALIA_INTEGRATION_KEY } };
for (const [name, { base, key }] of Object.entries(natalia)) {
	run('pnpm', ['--filter', 'natalia', 'build'], { env: { ASTRO_TELEMETRY_DISABLED: '1', NATALIA_LOCAL_FIXTURE: 'false', PUBLIC_CITA_BASE_URL: base, PUBLIC_NATALIA_INTEGRATION_KEY: key } });
	cpSync(join(root, 'apps/natalia/dist'), join(verification, name), { recursive: true });
}

const packaged = new Map();
const walk = directory => {
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) walk(path);
		else packaged.set(relative(root, path), readFileSync(path));
	}
};
for (const directory of ['.verification/cloudflare-bundle', '.verification/cloudflare-bundle-production', 'apps/web/.svelte-kit/cloudflare', ...Object.keys(natalia).map(name => `.verification/${name}`)])
	walk(join(root, directory));
const manifest = { revision, version: JSON.parse(readFileSync(join(root, 'apps/web/.svelte-kit/output/client/_app/version.json'), 'utf8')).version,
	files: [...packaged.keys()].sort().map(path => ({ path, bytes: packaged.get(path).length, sha256: createHash('sha256').update(packaged.get(path)).digest('hex') })) };
// Checked as a deployment will check it, so a defective package fails here and not at publication.
assertBuildArtifact(manifest, packaged);
for (const [name, link] of Object.entries(natalia)) nataliaSite(packaged, name, link);
writeFileSync(join(verification, 'cloudflare-bundle-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ revision, files: manifest.files.length,
	bundles: manifest.files.filter(file => file.path.endsWith('_worker.js') && file.path.startsWith('.verification/')) }, null, 2));

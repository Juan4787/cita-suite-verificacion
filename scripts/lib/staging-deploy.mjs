import { createHash } from 'node:crypto';
import { STAGING_PROJECT_REF } from './staging-database.mjs';

// The only Cloudflare targets the staging deployment accepts. Production is the
// Worker `app`; it is never named here and every check below rejects it.
export const CLOUDFLARE_ACCOUNT_ID = '52b358653379c162b5a07b10ae5e84b3';
export const STAGING_APP_WORKER = 'cita-suite-staging';
export const STAGING_SCHEDULER_WORKER = 'cita-suite-scheduler-staging';
export const STAGING_APP_ORIGIN = 'https://cita-suite-staging.cita-suite.workers.dev';
const STAGING_API = `https://${STAGING_PROJECT_REF}.supabase.co`;
const refused = () => new Error('The configuration is not the staging target. Nothing was deployed.');

/** The app Worker of staging: its name, account and Supabase project, no routes and no crons. */
export function assertStagingAppConfig(config) {
	const vars = config?.vars ?? {};
	if (config?.name !== STAGING_APP_WORKER || config.account_id !== CLOUDFLARE_ACCOUNT_ID ||
		vars.ODONTO_SUPABASE_URL !== STAGING_API || vars.PUBLIC_ODONTO_SUPABASE_URL !== STAGING_API ||
		vars.PUBLIC_SITE_URL !== STAGING_APP_ORIGIN || config.workers_dev !== true ||
		'env' in config || 'routes' in config || 'route' in config || 'triggers' in config)
		throw refused();
	return config;
}

/** The staging environment of the scheduler: its own name, the plan's crons and a binding to the staging app. */
export function assertStagingSchedulerConfig(config) {
	const staging = config?.env?.staging;
	const crons = config?.triggers?.crons;
	if (config?.account_id !== CLOUDFLARE_ACCOUNT_ID || staging?.name !== STAGING_SCHEDULER_WORKER ||
		JSON.stringify(staging.services) !== JSON.stringify([{ binding: 'APP', service: STAGING_APP_WORKER }]) ||
		!Array.isArray(crons) || crons.length !== 5 || JSON.stringify(staging.triggers?.crons) !== JSON.stringify(crons) ||
		'routes' in staging || 'route' in staging || config.workers_dev !== false)
		throw refused();
	return staging;
}

/** Legacy Supabase API keys are JWTs whose claims name the project and the role. */
export function stagingSupabaseKey(entries, role) {
	const entry = Array.isArray(entries) ? entries.find(item => item?.name === role && item?.type === 'legacy') : null;
	let claims = null;
	try { claims = JSON.parse(Buffer.from(String(entry?.api_key).split('.')[1], 'base64url').toString('utf8')); } catch {}
	if (claims?.ref !== STAGING_PROJECT_REF || claims?.role !== role)
		throw new Error(`The ${role} key does not belong to the staging project. Nothing was deployed.`);
	return entry.api_key;
}

/** Runtime secrets of the staging app, from the private files kept outside the repository. */
export function stagingAppSecrets(workerSecrets, apiKeys) {
	const anon = stagingSupabaseKey(apiKeys, 'anon');
	const secrets = {
		ODONTO_SUPABASE_SERVICE_ROLE_KEY: stagingSupabaseKey(apiKeys, 'service_role'),
		ODONTO_SUPABASE_ANON_KEY: anon,
		PUBLIC_ODONTO_SUPABASE_ANON_KEY: anon,
		VAPID_PUBLIC_KEY: workerSecrets?.VAPID_PUBLIC_KEY,
		PUBLIC_VAPID_PUBLIC_KEY: workerSecrets?.PUBLIC_VAPID_PUBLIC_KEY,
		VAPID_PRIVATE_KEY: workerSecrets?.VAPID_PRIVATE_KEY,
		INTERNAL_JOB_SECRET: workerSecrets?.INTERNAL_JOB_SECRET
	};
	if (secrets.VAPID_PUBLIC_KEY !== secrets.PUBLIC_VAPID_PUBLIC_KEY ||
		!/^[A-Za-z0-9_-]{87}$/.test(secrets.VAPID_PUBLIC_KEY ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(secrets.VAPID_PRIVATE_KEY ?? '') ||
		!/^[0-9a-f]{64}$/.test(secrets.INTERNAL_JOB_SECRET ?? ''))
		throw new Error('The staging Worker secrets are incomplete or malformed. Nothing was deployed.');
	return secrets;
}

/**
 * The downloaded build must be exactly the one the workflow described: every file
 * listed with its size and digest, nothing else, and the version naming the revision.
 */
export function assertBuildArtifact(manifest, files) {
	if (!/^[0-9a-f]{40}$/.test(manifest?.revision ?? '') || manifest.version !== manifest.revision || !Array.isArray(manifest.files))
		throw new Error('The build manifest does not name one exact revision.');
	const listed = new Map(manifest.files.map(file => [file.path, file]));
	if (listed.size !== manifest.files.length || listed.size !== files.size)
		throw new Error('The downloaded build does not contain exactly the files of its manifest.');
	for (const [path, contents] of files) {
		const expected = listed.get(path);
		if (!expected || expected.bytes !== contents.length || expected.sha256 !== createHash('sha256').update(contents).digest('hex'))
			throw new Error('The downloaded build differs from its manifest: ' + path);
	}
	for (const required of ['.verification/cloudflare-bundle/_worker.js', 'apps/web/.svelte-kit/cloudflare/.assetsignore'])
		if (!listed.has(required)) throw new Error('The build lacks ' + required);
	// The server bundle sits inside the assets directory; it must never be served as a file.
	if (!files.get('apps/web/.svelte-kit/cloudflare/.assetsignore').toString('utf8').split('\n').includes('_worker.js'))
		throw new Error('The assets directory would publish the server bundle.');
	return manifest.revision;
}

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { STAGING_PROJECT_REF } from './staging-database.mjs';

// The only Cloudflare targets the staging deployment accepts. Production is the
// Worker `app`; it is never named here and every check below rejects it.
export const CLOUDFLARE_ACCOUNT_ID = '52b358653379c162b5a07b10ae5e84b3';
export const STAGING_APP_WORKER = 'cita-suite-staging';
export const STAGING_SCHEDULER_WORKER = 'cita-suite-scheduler-staging';
export const STAGING_APP_ORIGIN = 'https://cita-suite-staging.cita-suite.workers.dev';
// Natalia's staging copy: the same static site, built for the staging booking and served
// by an assets-only Worker of this account.
export const STAGING_NATALIA_WORKER = 'natalia-frutos-staging';
export const STAGING_NATALIA_ORIGIN = 'https://natalia-frutos-staging.cita-suite.workers.dev';
// The synthetic practice the release verification books into from Natalia's staging copy.
export const STAGING_RELEASE_PRACTICE = Object.freeze({
	businessId: 'a953ba42-aa6e-4bd9-81cc-fde7ab9874b2', ownerId: '12be4144-c713-4630-a303-dfac4d392f52',
	serviceId: '4c10ffbb-ce06-41e0-a0d4-ca2f7868cafa', followUpServiceId: 'bb468885-eda6-4c12-95da-ac1227c8f0fa',
	professionalId: '04ce4991-0503-4464-894a-e09e9c3812c4',
	slug: 'release-staging', integrationKey: '54ad088d35aca1fb427b0240531c52ab', ownerEmail: 'release-owner@cita-suite-staging.test'
});
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

/** A downloaded build, read whole and checked against its manifest before anything uses it. */
export function loadBuildArtifact(directory) {
	const files = new Map();
	const walk = path => {
		for (const name of readdirSync(path)) {
			const entry = join(path, name);
			const stat = lstatSync(entry);
			if (stat.isSymbolicLink()) throw new Error('The downloaded build contains a link.');
			if (stat.isDirectory()) walk(entry);
			else files.set(relative(directory, entry), readFileSync(entry));
		}
	};
	walk(directory);
	const manifestPath = '.verification/cloudflare-bundle-manifest.json';
	const manifest = JSON.parse(files.get(manifestPath)?.toString('utf8') ?? 'null');
	files.delete(manifestPath);
	return { revision: assertBuildArtifact(manifest, files), files };
}

/**
 * One of Natalia's builds inside the release, by its path in the site: it must exist and
 * link to the expected booking and integration, never to another environment's.
 */
export function nataliaSite(files, name, { base, key }) {
	const prefix = `.verification/${name}/`;
	const site = new Map([...files].filter(([path]) => path.startsWith(prefix)).map(([path, contents]) => [path.slice(prefix.length), contents]));
	const home = site.get('index.html')?.toString('utf8') ?? '';
	const foreign = [...site].filter(([path]) => path.endsWith('.html')).some(([, contents]) => {
		const html = contents.toString('utf8');
		return [...html.matchAll(/data-booking-base="([^"]*)"/g)].some(match => match[1] !== base) ||
			[...html.matchAll(/data-booking-key="([^"]*)"/g)].some(match => match[1] !== key);
	});
	if (foreign || !home.includes(`data-booking-base="${base}"`) || !home.includes(`data-booking-key="${key}"`))
		throw new Error(`The build of ${name} does not link to its own booking. Nothing was used.`);
	return site;
}

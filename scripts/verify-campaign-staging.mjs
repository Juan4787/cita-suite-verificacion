import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStagingRelease } from './lib/staging-environment.mjs';
import { probeAnonymousExposure } from './lib/api-exposure.mjs';
import { nataliaSite } from './lib/staging-deploy.mjs';

// The deployed staging against the downloaded release: the app serves this revision and every
// client file of it, Natalia's staging copy serves its exact site, the anonymous key reaches no
// relation, and a real browser books from Natalia's copy into the release practice, recovers the
// booking without duplicating it and cancels it. Explicit opt-in only; nothing is deployed here.
const root = fileURLToPath(new URL('../', import.meta.url));
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
const { release, app, natalia, api, practice, serviceKey, anonKey } = loadStagingRelease(root, process.env, head);

// A redirect would serve another file than the one asked for: it fails like a wrong file.
async function body(url) {
	const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
	if (response.status !== 200) throw new Error(`Staging answered ${response.status} for ${new URL(url).pathname}.`);
	const contents = Buffer.from(await response.arrayBuffer());
	if (contents.length > 5_000_000) throw new Error('A staging file exceeded its bounded verification size.');
	return contents;
}
const digest = contents => createHash('sha256').update(contents).digest('hex');
async function compare(origin, entries) {
	const different = [];
	for (let start = 0; start < entries.length; start += 4)
		await Promise.all(entries.slice(start, start + 4).map(async ([path, expected]) => {
			if (digest(await body(origin + path)) !== digest(expected)) different.push(path);
		}));
	if (different.length) throw new Error(`${origin} serves files different from the release: ${different.slice(0, 5).join(', ')}`);
	return entries.length;
}

const served = JSON.parse(await body(app.origin + '/_app/version.json'));
if (served.version !== release.revision) throw new Error(`Staging serves ${served.version} instead of ${release.revision}.`);
const login = await fetch(app.origin + '/login', { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
const privateRoute = await fetch(app.origin + '/odonto', { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
if (login.status !== 200 || ![302, 303, 307].includes(privateRoute.status) || new URL(privateRoute.headers.get('location') ?? '/', app.origin).pathname !== '/login')
	throw new Error('Staging does not answer the login and the private redirect as the release does.');
const client = 'apps/web/.svelte-kit/cloudflare';
const clientFiles = await compare(app.origin, [...release.files].filter(([path]) => path.startsWith(`${client}/_app/immutable/`))
	.map(([path, contents]) => [path.slice(client.length), contents]));
// Cloudflare serves `page/index.html` at `/page/` and `page.html` at `/page`.
const site = nataliaSite(release.files, 'natalia-staging', { base: app.origin, key: practice.integrationKey });
const nataliaFiles = await compare(natalia.origin, [...site].map(([path, contents]) =>
	['/' + (path.endsWith('index.html') ? path.slice(0, -'index.html'.length) : path.replace(/\.html$/, '')), contents]));
const exposure = await probeAnonymousExposure({ api: api.origin, serviceKey, anonKey });
if (exposure.exposed.length) throw new Error('The anonymous key reaches staging relations: ' + JSON.stringify(exposure.exposed));

const journey = spawnSync('node', ['scripts/qa-natalia-direct-booking.mjs', '--staging'], { cwd: root, stdio: 'inherit',
	env: { ...process.env, CITA_STAGING_SERVICE_ROLE_KEY: serviceKey } });
if (journey.error || journey.status !== 0) throw new Error('The booking from Natalia\'s staging copy failed.');
const booked = JSON.parse(readFileSync(join(root, '.verification/native-booking-staging/results.json'), 'utf8'));
if (booked.passed !== true || booked.checks.length !== 2 || booked.transportSubstitution !== false)
	throw new Error('The staging booking receipt is incomplete.');
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, '.verification/staging.json'), JSON.stringify({
	scope: 'Deployed staging: Cloudflare Workers Free and Supabase Free. External Google-account login is not certified by this profile.',
	revision: release.revision, appOrigin: app.origin, nataliaOrigin: natalia.origin, clientFiles, nataliaFiles,
	anonymousRelations: exposure.relations, bookings: booked.checks.map(({ name, nativeSameTab, recoveryWithoutDuplicate, cancelled }) =>
		({ name, nativeSameTab, recoveryWithoutDuplicate, cancelled })), finishedAt: new Date().toISOString()
}, null, 2) + '\n');
console.log(JSON.stringify({ staging: 'passed', revision: release.revision, clientFiles, nataliaFiles, anonymousRelations: exposure.relations }));

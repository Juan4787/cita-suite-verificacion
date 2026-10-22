import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStagingRelease } from './lib/staging-environment.mjs';
import { probeAnonymousExposure } from './lib/api-exposure.mjs';
import { assertAppEntry, assertSupabaseOrigin, clientEntries, compareServed, siteEntries } from './lib/served-release.mjs';
import { nataliaSite } from './lib/staging-deploy.mjs';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';
import { loadRollbackArtifact } from './lib/integration-artifact.mjs';

// The deployed staging against the downloaded release: the app serves this revision and every
// client file of it, Natalia's staging copy serves its exact site, the anonymous key reaches no
// relation, and a real browser books from Natalia's copy into the release practice, recovers the
// booking without duplicating it and cancels it. Explicit opt-in only; nothing is deployed here.
const root = fileURLToPath(new URL('../', import.meta.url));
assertHostedIntegrationResources();
const rollback = process.argv[2] === '--rollback';
if (process.argv.length !== (rollback ? 3 : 2)) throw new Error('Usage: verify-campaign-staging.mjs [--rollback]');
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
const baseline = rollback ? loadRollbackArtifact(process.env, head) : null;
const { release, app, natalia, api, practice, serviceKey, anonKey } = loadStagingRelease(root,
	baseline ? { ...process.env, CITA_RELEASE_ARTIFACT: process.env.CITA_ROLLBACK_ARTIFACT } : process.env, baseline?.revision ?? head);

const policy = await assertAppEntry(app.origin, release.revision);
const contentSecurity = assertSupabaseOrigin(policy, api.origin);
const clientFiles = await compareServed(app.origin, clientEntries(release.files));
const site = nataliaSite(release.files, 'natalia-staging', { base: app.origin, key: practice.integrationKey });
const nataliaFiles = await compareServed(natalia.origin, siteEntries(site));
const exposure = await probeAnonymousExposure({ api: api.origin, serviceKey, anonKey });
if (exposure.exposed.length) throw new Error('The anonymous key reaches staging relations: ' + JSON.stringify(exposure.exposed));

const journey = spawnSync('node', ['scripts/qa-natalia-direct-booking.mjs', '--staging'], { cwd: root, stdio: 'inherit',
	env: { ...process.env, CITA_STAGING_SERVICE_ROLE_KEY: serviceKey } });
if (journey.error || journey.status !== 0) throw new Error('The booking from Natalia\'s staging copy failed.');
const booked = JSON.parse(readFileSync(join(root, '.verification/native-booking-staging/results.json'), 'utf8'));
if (booked.passed !== true || booked.checks.length !== 2 || booked.transportSubstitution !== false)
	throw new Error('The staging booking receipt is incomplete.');
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, rollback ? '.verification/staging-rollback.json' : '.verification/staging.json'), JSON.stringify({
	scope: 'Deployed staging: Cloudflare Workers Free and Supabase Free. External Google-account login is not certified by this profile.',
	purpose: rollback ? 'rollback-compatibility' : 'candidate', sourceRevision: head,
	revision: release.revision, appOrigin: app.origin, nataliaOrigin: natalia.origin, clientFiles, nataliaFiles, contentSecurity,
	anonymousRelations: exposure.relations, bookings: booked.checks.map(({ name, nativeSameTab, recoveryWithoutDuplicate, cancelled }) =>
		({ name, nativeSameTab, recoveryWithoutDuplicate, cancelled })), finishedAt: new Date().toISOString()
}, null, 2) + '\n');
console.log(JSON.stringify({ staging: 'passed', purpose: rollback ? 'rollback-compatibility' : 'candidate', revision: release.revision, clientFiles, nataliaFiles, anonymousRelations: exposure.relations }));

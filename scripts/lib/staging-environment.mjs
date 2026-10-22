import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STAGING_PROJECT_REF } from './staging-database.mjs';
import {
	STAGING_APP_ORIGIN, STAGING_NATALIA_ORIGIN, STAGING_RELEASE_PRACTICE, loadBuildArtifact, nataliaSite, stagingSupabaseKey
} from './staging-deploy.mjs';

// The release target: the repository's staging constants, the staging keys and the downloaded
// release of the revision under test. Never a descriptor file or the production .env. Local
// validation only: this function never creates resources or sends HTTP.
export function loadStagingRelease(root, env, revision) {
	if (!env.CITA_RELEASE_ARTIFACT)
		throw new Error('Staging is not verified: provide CITA_RELEASE_ARTIFACT, the downloaded release of this revision. No remote requests were sent.');
	const app = new URL(STAGING_APP_ORIGIN);
	const natalia = new URL(STAGING_NATALIA_ORIGIN);
	const api = new URL(`https://${STAGING_PROJECT_REF}.supabase.co`);
	const deniedHosts = new Set(['app.cita-suite.workers.dev', 'natalia-frutos.vercel.app', 'yjzferwuzbtgpmdnzlcb.supabase.co']);
	const envFile = join(root, '.env');
	if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
		const match = line.match(/^\s*(?:PUBLIC_)?ODONTO_SUPABASE_URL\s*=\s*["']?([^"'\s]+)/);
		if (match) {
			try { deniedHosts.add(new URL(match[1]).hostname); }
			catch { throw new Error('Cannot establish the configured production database denylist.'); }
		}
	}
	if ([app, natalia, api].some(url => deniedHosts.has(url.hostname))) throw new Error('Production targets are forbidden.');
	if (!/@[^@]+\.test$/.test(STAGING_RELEASE_PRACTICE.ownerEmail)) throw new Error('The release practice needs a synthetic identity.');
	// Legacy keys are JWTs that name their project and role: a key of another project is refused.
	const serviceKey = stagingSupabaseKey([{ name: 'service_role', type: 'legacy', api_key: env.CITA_STAGING_SERVICE_ROLE_KEY }], 'service_role');
	const anonKey = stagingSupabaseKey([{ name: 'anon', type: 'legacy', api_key: env.CITA_STAGING_ANON_KEY }], 'anon');
	const release = loadBuildArtifact(resolve(env.CITA_RELEASE_ARTIFACT));
	if (!/^[0-9a-f]{40}$/.test(revision ?? '') || release.revision !== revision)
		throw new Error('The downloaded release is not the build of the revision under test.');
	nataliaSite(release.files, 'natalia-staging', { base: app.origin, key: STAGING_RELEASE_PRACTICE.integrationKey });
	return { release, app, natalia, api, practice: STAGING_RELEASE_PRACTICE, serviceKey, anonKey };
}

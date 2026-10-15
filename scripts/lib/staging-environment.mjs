import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingDatabaseTarget } from './e2e-environment.mjs';

// Local validation only. This function never creates resources or sends HTTP.
export function loadStagingEnvironment(root, env) {
	if (!env.CITA_STAGING_DESCRIPTOR)
		throw new Error('Staging is not verified: provide CITA_STAGING_DESCRIPTOR for a separate synthetic environment. No remote requests were sent.');
	const descriptor = JSON.parse(readFileSync(env.CITA_STAGING_DESCRIPTOR, 'utf8'));
	if (descriptor.environment !== 'isolated-synthetic-staging')
		throw new Error('Only an explicitly isolated synthetic staging environment is accepted.');
	const origin = value => {
		let url;
		try { url = new URL(value); } catch { throw new Error('Invalid staging origin.'); }
		if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password)
			throw new Error('Staging origins must be exact HTTPS origins.');
		return url;
	};
	const app = origin(descriptor.appOrigin);
	const natalia = origin(descriptor.nataliaOrigin);
	const api = origin(descriptor.supabaseOrigin);
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
	if (!/^[a-z0-9]{8,32}$/.test(descriptor.supabaseProjectRef) || api.hostname !== `${descriptor.supabaseProjectRef}.supabase.co`)
		throw new Error('Staging API does not match its declared separate Supabase project.');
	if (!/^[0-9a-f]{40}$/.test(descriptor.revision)) throw new Error('An exact candidate revision is required.');
	if (!/^[0-9a-f]{32}$/.test(descriptor.bookingIntegrationKey)) throw new Error('The staging booking integration key is required.');
	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(descriptor.syntheticBusinessId) ||
		!/@[^@]+\.test$/.test(descriptor.testEmail) || !/@[^@]+\.test$/.test(descriptor.masterEmail))
		throw new Error('Dedicated synthetic business and test identities are required.');
	for (const key of ['CITA_STAGING_ANON_KEY', 'CITA_STAGING_SERVICE_ROLE_KEY', 'CITA_STAGING_TEST_PASSWORD', 'CITA_STAGING_MASTER_PASSWORD', 'CITA_STAGING_DATABASE_URL'])
		if (!env[key]?.trim()) throw new Error(`Missing ${key}; staging coverage cannot pass.`);
	assertStagingDatabaseTarget(env.CITA_STAGING_DATABASE_URL, descriptor.supabaseProjectRef);
	return { descriptor, app, natalia, api };
}

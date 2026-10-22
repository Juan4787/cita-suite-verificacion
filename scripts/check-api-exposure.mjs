import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeAnonymousExposure } from './lib/api-exposure.mjs';
import { STAGING_PROJECT_REF } from './lib/staging-database.mjs';
import { stagingSupabaseKey } from './lib/staging-deploy.mjs';

// What the anonymous key reaches on a hosted project, from this machine with the private
// configuration: every relation the API exposes must refuse it. GET requests only, of at most
// one row; the receipt keeps the outcome per relation and never a key or a value.
const root = fileURLToPath(new URL('../', import.meta.url));
const [target] = process.argv.slice(2);
if (!['staging', 'production'].includes(target) || process.argv.length !== 3) throw new Error('Usage: check-api-exposure.mjs staging|production');
const PRODUCTION_REF = 'yjzferwuzbtgpmdnzlcb';
const claims = key => { try { return JSON.parse(Buffer.from(String(key).split('.')[1], 'base64url').toString('utf8')); } catch { return null; } };
let ref, serviceKey, anonKey;
if (target === 'staging') {
	const keys = JSON.parse(readFileSync(join(homedir(), '.config/cita-suite/staging/api-keys.json'), 'utf8'));
	[ref, serviceKey, anonKey] = [STAGING_PROJECT_REF, stagingSupabaseKey(keys, 'service_role'), stagingSupabaseKey(keys, 'anon')];
} else {
	const env = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split('\n')
		.map(line => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter(Boolean)
		.map(([, key, value]) => [key, value.replace(/^["']|["']$/g, '')]));
	[ref, serviceKey, anonKey] = [PRODUCTION_REF, env.ODONTO_SUPABASE_SERVICE_ROLE_KEY, env.ODONTO_SUPABASE_ANON_KEY];
	if (env.ODONTO_SUPABASE_URL?.replace(/\/$/, '') !== `https://${ref}.supabase.co` || claims(serviceKey)?.ref !== ref || claims(serviceKey)?.role !== 'service_role' ||
		claims(anonKey)?.ref !== ref || claims(anonKey)?.role !== 'anon')
		throw new Error('The production keys are not the expected ones. Nothing was sent.');
}
const result = { target, project: ref, at: new Date().toISOString(),
	...await probeAnonymousExposure({ api: `https://${ref}.supabase.co`, serviceKey, anonKey }) };
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, `.verification/api-exposure-${target}-${result.at.slice(0, 10)}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (result.exposed.length) process.exitCode = 1;

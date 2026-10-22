import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeAnonymousExposure } from './lib/api-exposure.mjs';
import { PRODUCTION_REF, productionKeys, readEnvFile } from './lib/production-database.mjs';
import { STAGING_PROJECT_REF } from './lib/staging-database.mjs';
import { stagingSupabaseKey } from './lib/staging-deploy.mjs';

// What the anonymous key reaches on a hosted project, from this machine with the private
// configuration: every relation the API exposes must refuse it. GET requests only, of at most
// one row; the receipt keeps the outcome per relation and never a key or a value.
const root = fileURLToPath(new URL('../', import.meta.url));
const [target] = process.argv.slice(2);
if (!['staging', 'production'].includes(target) || process.argv.length !== 3) throw new Error('Usage: check-api-exposure.mjs staging|production');
let ref, serviceKey, anonKey;
if (target === 'staging') {
	const keys = JSON.parse(readFileSync(join(homedir(), '.config/cita-suite/staging/api-keys.json'), 'utf8'));
	[ref, serviceKey, anonKey] = [STAGING_PROJECT_REF, stagingSupabaseKey(keys, 'service_role'), stagingSupabaseKey(keys, 'anon')];
} else {
	ref = PRODUCTION_REF;
	({ serviceKey, anonKey } = productionKeys(readEnvFile(join(root, '.env'))));
}
const result = { target, project: ref, at: new Date().toISOString(),
	...await probeAnonymousExposure({ api: `https://${ref}.supabase.co`, serviceKey, anonKey }) };
mkdirSync(join(root, '.verification'), { recursive: true });
// One receipt per run: a later probe of the same day never replaces an earlier one.
writeFileSync(join(root, `.verification/api-exposure-${target}-${result.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (result.exposed.length) process.exitCode = 1;

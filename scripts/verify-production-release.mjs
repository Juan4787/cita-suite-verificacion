import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeAnonymousExposure } from './lib/api-exposure.mjs';
import { PRODUCTION_API_ORIGIN, productionKeys, readEnvFile } from './lib/production-database.mjs';
import { PRODUCTION_APP_ORIGIN, PRODUCTION_NATALIA_INTEGRATION_KEY, PRODUCTION_NATALIA_ORIGIN } from './lib/production-deploy.mjs';
import { assertAppEntry, assertSupabaseOrigin, clientEntries, compareServed, siteEntries } from './lib/served-release.mjs';
import { loadBuildArtifact, nataliaSite } from './lib/staging-deploy.mjs';

// Production against the downloaded release, after its publication (publicacion-y-reversion.md):
// the app serves this revision, its login page and the private redirect; every client file of
// the release is served identically; the page's policy admits exactly the production Supabase
// project; and the anonymous key reaches no relation. `--natalia`, once Natalia's site is
// published, also requires its exact files. Read-only: GET requests, and one row at most per
// relation for the anonymous probe. The receipt keeps outcomes, never a key or a value.
const root = fileURLToPath(new URL('../', import.meta.url));
const [artifactArgument, option] = process.argv.slice(2);
if (!artifactArgument || process.argv.length > 4 || (option !== undefined && option !== '--natalia'))
	throw new Error('Usage: verify-production-release.mjs <downloaded build directory> [--natalia]');
const { revision, files } = loadBuildArtifact(resolve(artifactArgument));
const { serviceKey, anonKey } = productionKeys(readEnvFile(join(root, '.env')));

const policy = await assertAppEntry(PRODUCTION_APP_ORIGIN, revision);
const contentSecurity = assertSupabaseOrigin(policy, PRODUCTION_API_ORIGIN);
const clientFiles = await compareServed(PRODUCTION_APP_ORIGIN, clientEntries(files));
const nataliaFiles = option === '--natalia' ? await compareServed(PRODUCTION_NATALIA_ORIGIN, siteEntries(nataliaSite(files, 'natalia-production',
	{ base: PRODUCTION_APP_ORIGIN, key: PRODUCTION_NATALIA_INTEGRATION_KEY }))) : null;
const exposure = await probeAnonymousExposure({ api: PRODUCTION_API_ORIGIN, serviceKey, anonKey });
const receipt = { at: new Date().toISOString(), revision, appOrigin: PRODUCTION_APP_ORIGIN, clientFiles, contentSecurity,
	natalia: nataliaFiles === null ? 'not checked' : { origin: PRODUCTION_NATALIA_ORIGIN, files: nataliaFiles },
	anonymousRelations: exposure.relations, exposed: exposure.exposed };
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, `.verification/production-release-${receipt.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
if (exposure.exposed.length) process.exitCode = 1;

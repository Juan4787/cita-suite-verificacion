import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBuildArtifact, nataliaSite } from './lib/staging-deploy.mjs';
import { PRODUCTION_APP_ORIGIN, PRODUCTION_NATALIA_INTEGRATION_KEY } from './lib/production-deploy.mjs';
import { assertLightVerificationResources } from './lib/verification-resources.mjs';

// Local preparation only. No credentials, API calls, Git mutation or deployment.
const [artifact, metadataPath, expectedHead, expectedTree] = process.argv.slice(2);
if (process.argv.length !== 6 || ![expectedHead, expectedTree].every(value => /^[0-9a-f]{40}$/.test(value ?? '')))
	throw new Error('Usage: prepare-natalia-publication.mjs <release> <filtered-project-metadata.json> <current-main-sha> <current-tree-sha>');
assertLightVerificationResources();
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
if (metadata.id !== 'prj_ddhAhez9VNro373XWSykLkhU5vBS' || metadata.name !== 'natalia-frutos' ||
	metadata.accountId !== 'team_CGSlkRXKKlw98jb3O2wSmcyt' || metadata.rootDirectory !== null || metadata.framework !== null ||
	metadata.link?.type !== 'github' || metadata.link?.org !== 'juan-altamira' || metadata.link?.repo !== 'web-natalia' ||
	metadata.link?.repoId !== 1416254094 || metadata.link?.productionBranch !== 'main' ||
	!/^dpl_[A-Za-z0-9]+$/.test(metadata.productionDeployment ?? ''))
	throw new Error('The inspected project differs from the reviewed Natalia destination. Nothing was prepared.');
const { revision, files } = loadBuildArtifact(resolve(artifact));
const site = nataliaSite(files, 'natalia-production', { base: PRODUCTION_APP_ORIGIN, key: PRODUCTION_NATALIA_INTEGRATION_KEY });
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, '.verification', `natalia-publication-${revision.slice(0, 7)}`);
// Fail on any previous preparation. Never replace its bytes or receipt.
mkdirSync(directory);
const manifest = [];
function save(path, contents) {
	if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid publication path.');
	const target = join(directory, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, contents, { flag: 'wx' });
	manifest.push({ path, bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') });
}
for (const [path, contents] of site) save(`site/${path}`, contents);
const configuration = { framework: null, buildCommand: '', installCommand: '', outputDirectory: 'site' };
save('vercel.json', Buffer.from(JSON.stringify(configuration, null, 2) + '\n'));
writeFileSync(join(directory, 'publication-plan.json'), JSON.stringify({
	at: new Date().toISOString(), status: 'prepared-only; not published; release gates still pending', revision,
	repository: 'juan-altamira/web-natalia', repositoryId: 1416254094, branch: 'main', expectedHead, expectedTree,
	projectId: metadata.id, accountId: metadata.accountId, previousProductionDeployment: metadata.productionDeployment,
	configuration, files: manifest,
	rollback: 'The saved Git tree reverses repository changes only. Restore the verified previous production deployment or publish an archived copy of its verified served files through a forward commit. Do not assume a linked Git HEAD matches that deployment. Keep main aligned with the restored files, use an expected-SHA lease, inspect intervening changes and never rewrite history.'
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ directory, revision, siteFiles: site.size, gitChanges: manifest.length, status: 'prepared-only' }));

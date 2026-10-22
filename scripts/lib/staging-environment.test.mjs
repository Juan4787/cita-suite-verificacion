import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadStagingRelease } from './staging-environment.mjs';
import { STAGING_PROJECT_REF } from './staging-database.mjs';
import { STAGING_APP_ORIGIN, STAGING_RELEASE_PRACTICE } from './staging-deploy.mjs';

const revision = 'a'.repeat(40);
const key = (ref, role) => ['e30', Buffer.from(JSON.stringify({ ref, role })).toString('base64url'), 'signature'].join('.');
const natalia = `<a data-booking data-booking-base="${STAGING_APP_ORIGIN}" data-booking-key="${STAGING_RELEASE_PRACTICE.integrationKey}">Reservar</a>`;

function fixture(run) {
	const root = mkdtempSync(join(tmpdir(), 'cita-staging-guard-'));
	const release = join(root, 'release');
	const files = {
		'.verification/cloudflare-bundle/_worker.js': 'export default {}',
		'apps/web/.svelte-kit/cloudflare/.assetsignore': '_worker.js\n',
		'apps/web/.svelte-kit/cloudflare/_app/version.json': JSON.stringify({ version: revision }),
		'.verification/natalia-staging/index.html': natalia
	};
	const write = (revisionOfBuild = revision) => {
		rmSync(release, { recursive: true, force: true });
		for (const [path, contents] of Object.entries(files)) {
			mkdirSync(dirname(join(release, path)), { recursive: true });
			writeFileSync(join(release, path), contents);
		}
		writeFileSync(join(release, '.verification/cloudflare-bundle-manifest.json'), JSON.stringify({ revision: revisionOfBuild, version: revisionOfBuild,
			files: Object.entries(files).map(([path, contents]) => ({ path, bytes: Buffer.byteLength(contents), sha256: createHash('sha256').update(contents).digest('hex') })) }));
	};
	const env = { CITA_RELEASE_ARTIFACT: release,
		CITA_STAGING_SERVICE_ROLE_KEY: key(STAGING_PROJECT_REF, 'service_role'), CITA_STAGING_ANON_KEY: key(STAGING_PROJECT_REF, 'anon') };
	const check = () => loadStagingRelease(root, env, revision);
	write();
	try { run({ root, env, files, write, check }); } finally { rmSync(root, { recursive: true }); }
}

test('release preflight requires the downloaded release of the revision under test', () => fixture(({ env, write, check }) => {
	assert.equal(check().release.revision, revision);
	write('b'.repeat(40));
	assert.throws(check, /not the build of the revision under test/);
	delete env.CITA_RELEASE_ARTIFACT;
	assert.throws(check, /No remote requests/);
}));
test('the configured production project is refused before release work', () => fixture(({ root, check }) => {
	writeFileSync(join(root, '.env'), `ODONTO_SUPABASE_URL=https://${STAGING_PROJECT_REF}.supabase.co\n`);
	assert.throws(check, /Production targets/);
}));
test('keys of another project or role are refused without echoing them', () => fixture(({ env, check }) => {
	env.CITA_STAGING_SERVICE_ROLE_KEY = key('yjzferwuzbtgpmdnzlcb', 'service_role');
	assert.throws(check, error => /does not belong to the staging project/.test(error.message) && !error.message.includes(env.CITA_STAGING_SERVICE_ROLE_KEY));
	env.CITA_STAGING_SERVICE_ROLE_KEY = key(STAGING_PROJECT_REF, 'service_role');
	env.CITA_STAGING_ANON_KEY = key(STAGING_PROJECT_REF, 'service_role');
	assert.throws(check, /anon key does not belong/);
}));
test('a release whose Natalia books elsewhere is refused', () => fixture(({ files, write, check }) => {
	files['.verification/natalia-staging/index.html'] = natalia.replace(STAGING_APP_ORIGIN, 'https://app.cita-suite.workers.dev');
	write();
	assert.throws(check, /does not link to its own booking/);
	delete files['.verification/natalia-staging/index.html'];
	write();
	assert.throws(check, /does not link to its own booking/);
}));

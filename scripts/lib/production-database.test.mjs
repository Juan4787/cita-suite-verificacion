import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productionConnection, productionEnvironment, productionKeys, readEnvFile } from './production-database.mjs';

const production = 'postgresql://postgres.yjzferwuzbtgpmdnzlcb:PRIVATE_SENTINEL@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';

test('the production session is the São Paulo pooler of the project, always on the session port', () => {
	const url = productionConnection(production);
	assert.equal(url.port, '5432');
	assert.equal(url.hostname, 'aws-0-sa-east-1.pooler.supabase.com');
	assert.equal(decodeURIComponent(url.username), 'postgres.yjzferwuzbtgpmdnzlcb');
	assert.equal(productionConnection(production.replace('postgresql:', 'postgres:')).port, '5432');
});

test('staging, other projects, regions, hosts, databases and malformed values are refused without repeating them', () => {
	for (const value of [undefined, '', 'not a connection',
		'postgresql://postgres.ikaudqoilclfnztkxubz:PRIVATE_SENTINEL@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
		'postgresql://postgres.otherproject:PRIVATE_SENTINEL@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
		'postgresql://postgres.yjzferwuzbtgpmdnzlcb:PRIVATE_SENTINEL@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
		'postgresql://postgres.yjzferwuzbtgpmdnzlcb:PRIVATE_SENTINEL@evil.example:5432/postgres',
		'postgresql://postgres.yjzferwuzbtgpmdnzlcb:PRIVATE_SENTINEL@aws-0-sa-east-1.pooler.supabase.com.evil.example:5432/postgres',
		'postgresql://postgres.yjzferwuzbtgpmdnzlcb:PRIVATE_SENTINEL@aws-0-sa-east-1.pooler.supabase.com:5432/other',
		'postgresql://postgres.yjzferwuzbtgpmdnzlcb@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
		'https://postgres.yjzferwuzbtgpmdnzlcb:PRIVATE_SENTINEL@aws-0-sa-east-1.pooler.supabase.com:5432/postgres']) {
		assert.throws(() => productionConnection(value), (error) => /No connection was attempted/.test(error.message) &&
			!/PRIVATE_SENTINEL/.test(error.message));
	}
});

test('the private env file is read as KEY=value lines, and its connection is checked', () => {
	const root = mkdtempSync(join(tmpdir(), 'cita-production-env-'));
	try {
		writeFileSync(join(root, '.env'), `# comment\nSUPABASE_DB_URL="${production}"\nODONTO_SUPABASE_URL='https://yjzferwuzbtgpmdnzlcb.supabase.co'\nnot a line\n`);
		assert.deepEqual(Object.keys(readEnvFile(join(root, '.env'))), ['SUPABASE_DB_URL', 'ODONTO_SUPABASE_URL']);
		const { env, database } = productionEnvironment(root);
		assert.equal(env.ODONTO_SUPABASE_URL, 'https://yjzferwuzbtgpmdnzlcb.supabase.co');
		assert.equal(database.port, '5432');
		writeFileSync(join(root, '.env'), 'SUPABASE_DB_URL=postgresql://postgres.ikaudqoilclfnztkxubz:x@aws-1-us-west-2.pooler.supabase.com:5432/postgres\n');
		assert.throws(() => productionEnvironment(root), /not the production project/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('the API keys must be of the production project and of their own roles', () => {
	const key = (claims) => ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'PRIVATE_SENTINEL'].join('.');
	const env = { ODONTO_SUPABASE_URL: 'https://yjzferwuzbtgpmdnzlcb.supabase.co/',
		ODONTO_SUPABASE_SERVICE_ROLE_KEY: key({ ref: 'yjzferwuzbtgpmdnzlcb', role: 'service_role' }),
		ODONTO_SUPABASE_ANON_KEY: key({ ref: 'yjzferwuzbtgpmdnzlcb', role: 'anon' }) };
	assert.deepEqual(productionKeys(env), { serviceKey: env.ODONTO_SUPABASE_SERVICE_ROLE_KEY, anonKey: env.ODONTO_SUPABASE_ANON_KEY });
	for (const wrong of [
		{ ODONTO_SUPABASE_URL: 'https://ikaudqoilclfnztkxubz.supabase.co' },
		{ ODONTO_SUPABASE_SERVICE_ROLE_KEY: env.ODONTO_SUPABASE_ANON_KEY },
		{ ODONTO_SUPABASE_ANON_KEY: env.ODONTO_SUPABASE_SERVICE_ROLE_KEY },
		{ ODONTO_SUPABASE_SERVICE_ROLE_KEY: key({ ref: 'ikaudqoilclfnztkxubz', role: 'service_role' }) },
		{ ODONTO_SUPABASE_ANON_KEY: 'not a key' },
		{ ODONTO_SUPABASE_SERVICE_ROLE_KEY: undefined }
	]) assert.throws(() => productionKeys({ ...env, ...wrong }), (error) => /not the expected ones/.test(error.message) && !/PRIVATE_SENTINEL/.test(error.message));
});

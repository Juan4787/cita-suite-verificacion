import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../inspect-staging-database.mjs', import.meta.url));
test('staging inspection rejects production, other projects and malformed targets before connecting', () => {
	for (const value of [undefined, 'not a connection',
		'postgresql://postgres.yjzferwuzbtgpmdnzlcb:PRIVATE_SENTINEL@aws-1-sa-east-1.pooler.supabase.com:5432/postgres',
		'postgresql://postgres.otherproject:PRIVATE_SENTINEL@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
		'postgresql://postgres.ikaudqoilclfnztkxubz:PRIVATE_SENTINEL@evil.example:5432/postgres',
		'postgresql://postgres.ikaudqoilclfnztkxubz:PRIVATE_SENTINEL@aws-1-us-west-2.pooler.supabase.com:6543/postgres']) {
		const env = { ...process.env, PATH: '/nonexistent' };
		if (value === undefined) delete env.CITA_STAGING_DATABASE_URL;
		else env.CITA_STAGING_DATABASE_URL = value;
		const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 5_000 });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /No connection was attempted/);
		assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SENTINEL|ENOENT/);
	}
});

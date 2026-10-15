import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
function check(files) {
	const directory = mkdtempSync(join(tmpdir(), 'cita-architecture-'));
	try {
		for (const [path, contents] of Object.entries(files)) {
			const target = join(directory, 'apps/web/src/lib', path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, contents);
		}
		return spawnSync(join(root, 'node_modules/.bin/depcruise'),
			['--config', join(root, '.dependency-cruiser.cjs'), '--output-type', 'err', 'apps/web/src'],
			{ cwd: directory, encoding: 'utf8' });
	} finally { rmSync(directory, { recursive: true }); }
}

const base = {
	'server/access/internal.ts': 'export const permission = true;',
	'server/access/index.ts': "export { permission } from './internal';"
};

test('public cross-area interfaces are permitted', () => {
	const result = check({ ...base, 'server/team/index.ts': "import {permission} from '../access/index'; export const allowed=permission;" });
	assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('a cross-area private import is rejected', () => {
	const result = check({ ...base, 'server/team/index.ts': "import {permission} from '../access/internal'; export const allowed=permission;" });
	assert.notEqual(result.status, 0);
	assert.match(result.stdout + result.stderr, /public-interface-of-access/);
});
test('browser code cannot import a server public interface', () => {
	const result = check({ ...base, 'client/unsafe.ts': "import {permission} from '../server/access/index'; console.log(permission);" });
	assert.notEqual(result.status, 0);
	assert.match(result.stdout + result.stderr, /browser-cannot-import-server/);
});
test('a real Svelte component cannot import server code at runtime', () => {
	const result = check({ ...base, 'unsafe.svelte': "<script lang='ts'>import {permission} from './server/access/index';</script><p>{permission}</p>" });
	assert.notEqual(result.status, 0);
	assert.match(result.stdout + result.stderr, /browser-cannot-import-server/);
});
test('runtime dependency cycles are rejected', () => {
	const result = check({
		'a.ts': "import {b} from './b'; export function a(){return b();}",
		'b.ts': "import {a} from './a'; export function b(){return a();}"
	});
	assert.notEqual(result.status, 0);
	assert.match(result.stdout + result.stderr, /no-circular-runtime-dependencies/);
});

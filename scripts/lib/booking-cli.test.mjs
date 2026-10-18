import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('the integration CLI reaches its usage validation under the pinned Node runtime', () => {
 const root = fileURLToPath(new URL('../../', import.meta.url));
 // No arguments: validation exits before reading .env or making any request.
 const result = spawnSync(process.execPath, ['scripts/booking-integration.mjs'], {
  cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env }
 });
 assert.equal(result.error, undefined);
 assert.equal(result.status, 1);
 assert.match(result.stderr, /Uso: node scripts\/booking-integration\.mjs/);
 assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/);
});

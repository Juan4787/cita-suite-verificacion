import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The plan consolidates session resolution in the common request context: a request's
// identity is the one hooks verified with Auth. Reading it from the token's claims is
// reserved to the modules that define that rule, where the demo profile also lives.
const ALLOWED = new Set([
 'apps/web/src/hooks.server.ts',
 'apps/web/src/lib/server/platform/supabase.ts',
 'apps/web/src/lib/server/access/public/odonto-context.ts',
 'apps/web/src/lib/server/access/public/business.ts'
]);
const DECODERS = /\b(getAuthUserId|getUserIdFromAccessToken|getEmailFromAccessToken)\(/;

test('request identity comes from the verified session, never from decoding the token elsewhere', () => {
 assert.equal(DECODERS.test('const id = await getAuthUserId(supabase, token);'), true);
 assert.equal(DECODERS.test('const id = locals.verifiedUser?.id;'), false);
 const failures = [];
 function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   const filename = path.join(dir, entry.name);
   if (entry.isDirectory()) walk(filename);
   else if (/\.(ts|svelte)$/.test(filename) && !/\.(test|typecheck)\.ts$/.test(filename) &&
    !ALLOWED.has(filename.split(path.sep).join('/')) && DECODERS.test(fs.readFileSync(filename, 'utf8')))
    failures.push(filename);
  }
 }
 walk('apps/web/src');
 assert.deepEqual(failures.sort(), []);
});

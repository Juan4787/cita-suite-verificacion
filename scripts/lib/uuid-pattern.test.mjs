import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// An identifier has one definition, `isUuid` in @cita-suite/shared/uuid, so the same id
// cannot be valid in one route and rejected in another. Two patterns are not copies:
// booking request ids, which the booking flow creates as random version 4 values, and
// Natalia's site, a separate deployable without the shared package, which mirrors the
// canonical form.
const ALLOWED = new Map([
 ['packages/shared/src/uuid.ts', 1],
 ['packages/shared/src/booking-integration.ts', 1],
 ['apps/natalia/src/scripts/public.ts', 1]
]);
const UUID_LITERAL = /\{8\}-[^/\n]*\{4\}-[^/\n]*\{12\}/g;

test('identifier patterns are not copied', () => {
 assert.equal('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i'.match(UUID_LITERAL)?.length, 1);
 assert.equal('/^datos-paciente-\\d{8}-\\d{4}\\.xlsx$/'.match(UUID_LITERAL), null);
 const failures = [];
 function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   const filename = path.join(dir, entry.name);
   if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(filename); continue; }
   if (!/\.(ts|svelte|js|mjs|astro)$/.test(filename) || /\.(test|typecheck)\.ts$/.test(filename)) continue;
   const relative = filename.split(path.sep).join('/');
   const count = fs.readFileSync(filename, 'utf8').match(UUID_LITERAL)?.length ?? 0;
   if (count > (ALLOWED.get(relative) ?? 0)) failures.push(`${relative}: ${count}`);
  }
 }
 for (const root of ['apps/web/src', 'apps/natalia/src', 'apps/scheduler/src', 'packages/shared/src']) if (fs.existsSync(root)) walk(root);
 assert.deepEqual(failures.sort(), []);
});

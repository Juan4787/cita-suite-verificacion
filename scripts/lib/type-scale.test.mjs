import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Type sizes come from the scale (Tailwind's, plus the named roles of DESIGN.md in
// tailwind.config.js), not from literal values repeated across views.
const LITERAL_SIZE = /\btext-\[(?:\d+(?:\.\d+)?)(?:px|rem|em)\]/g;

test('views take their type sizes from the scale', () => {
 assert.deepEqual('class="text-[11px] sm:text-[1.7rem] text-[#c4b5fd] text-micro"'.match(LITERAL_SIZE), ['text-[11px]', 'text-[1.7rem]']);
 const failures = [];
 function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   const filename = path.join(dir, entry.name);
   if (entry.isDirectory()) walk(filename);
   else if (filename.endsWith('.svelte'))
    for (const literal of fs.readFileSync(filename, 'utf8').match(LITERAL_SIZE) ?? []) failures.push(`${filename.split(path.sep).join('/')}: ${literal}`);
  }
 }
 walk('apps/web/src');
 assert.deepEqual(failures, []);
});

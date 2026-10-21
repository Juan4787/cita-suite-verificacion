import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The application loads Inter at 400, 500, 600 and 700 (app.html), the weights DESIGN.md
// documents. A class or rule asking for another weight promises a look the browser cannot
// draw: it falls back to the nearest loaded face, so the code no longer says what users see.
const LOADED = new Set(['400', '500', '600', '700']);
const CLASS_WEIGHTS = { 'font-thin': '100', 'font-extralight': '200', 'font-light': '300', 'font-normal': '400',
 'font-medium': '500', 'font-semibold': '600', 'font-bold': '700', 'font-extrabold': '800', 'font-black': '900' };

function unloadedWeights(text) {
 const found = [];
 for (const [name, weight] of Object.entries(CLASS_WEIGHTS))
  if (!LOADED.has(weight) && new RegExp(`(^|[\\s"'\`:{])${name}(?=[\\s"'\`}]|$)`).test(text)) found.push(name);
 for (const match of text.matchAll(/\bfont-\[(\d{3})\]/g)) if (!LOADED.has(match[1])) found.push(match[0]);
 for (const match of text.matchAll(/font-weight:\s*(\d{3})\b/g)) if (!LOADED.has(match[1])) found.push(match[0]);
 return found;
}

test('styles ask only for the Inter weights the application loads', () => {
 const app = fs.readFileSync('apps/web/src/app.html', 'utf8');
 assert.match(app, /family=Inter:wght@400;500;600;700&/, 'the loaded weights changed: update LOADED and DESIGN.md together');
 assert.deepEqual(unloadedWeights('class="font-bold text-sm" style="font-weight: 600"'), []);
 assert.deepEqual(unloadedWeights('class="font-black" font-[650] font-weight: 800'), ['font-black', 'font-[650]', 'font-weight: 800']);
 const failures = [];
 function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   const filename = path.join(dir, entry.name);
   if (entry.isDirectory()) walk(filename);
   else if (/\.(svelte|css|ts)$/.test(filename) && !/\.(test|typecheck)\.ts$/.test(filename))
    for (const item of unloadedWeights(fs.readFileSync(filename, 'utf8'))) failures.push(`${filename.split(path.sep).join('/')}: ${item}`);
  }
 }
 walk('apps/web/src');
 assert.deepEqual([...new Set(failures)].sort(), []);
});

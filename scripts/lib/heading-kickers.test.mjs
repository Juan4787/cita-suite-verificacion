import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// A heading carries its own weight: no label above it (a pill, an uppercase tag or an
// "eyebrow"), which the design floor bans. A status the heading does not say goes after it.
const KICKER = /class="[^"]*\b(ux-badge|uppercase|patient-summary-context)\b/;

function kickers(text) {
 const found = [];
 const lines = text.split('\n');
 lines.forEach((line, index) => {
  if (/\beyebrow=/.test(line)) found.push(`${index + 1}: eyebrow`);
  if (!/<h[1-3]\b/.test(line)) return;
  let previous = index - 1;
  while (previous >= 0 && !lines[previous].trim()) previous -= 1;
  if (previous >= 0 && KICKER.test(lines[previous])) found.push(`${previous + 1}: kicker`);
 });
 return found;
}

test('headings have no kicker or eyebrow above them', () => {
 assert.deepEqual(kickers('<p class="ux-badge">Semana</p>\n<h1 class="ux-title">Agenda</h1>'), ['1: kicker']);
 assert.deepEqual(kickers('<h1 class="ux-title">Agenda</h1>\n<p class="ux-badge">Confirmado</p>'), []);
 assert.deepEqual(kickers('<DismissibleNotice eyebrow="Datos" title="Falta"'), ['1: eyebrow']);
 const failures = [];
 function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   const filename = path.join(dir, entry.name);
   if (entry.isDirectory()) walk(filename);
   else if (filename.endsWith('.svelte'))
    for (const item of kickers(fs.readFileSync(filename, 'utf8'))) failures.push(`${filename.split(path.sep).join('/')}:${item}`);
  }
 }
 walk('apps/web/src');
 assert.deepEqual(failures, []);
});

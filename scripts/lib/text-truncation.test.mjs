import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// DESIGN.md, "Texto completo": inside the page and its dialogs no text of the task is
// cut with an ellipsis; it wraps. The header and navigation may shorten what the page
// shows in full, and a preview that expands to its complete text may clamp: each such
// reviewed exception carries data-truncation="allowed".
const CUT = /\b(truncate|line-clamp-\d+)\b/;

function unreviewedCuts(text) {
 const found = [];
 for (const match of text.matchAll(/<[a-zA-Z][\w.:-]*\s[^>]*>/g)) {
  const tag = match[0];
  if (CUT.test(tag) && !/data-truncation="allowed"/.test(tag))
   found.push(String(text.slice(0, match.index).split('\n').length));
 }
 return found;
}

test('task text wraps instead of being cut, except reviewed exceptions', () => {
 assert.deepEqual(unreviewedCuts('<p class="truncate font-bold">{name}</p>'), ['1']);
 assert.deepEqual(unreviewedCuts('<span\n class="line-clamp-1"\n>x</span>'), ['1']);
 assert.deepEqual(unreviewedCuts('<span class="truncate" data-truncation="allowed">x</span><p class="break-words">y</p>'), []);
 const failures = [];
 function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   const filename = path.join(dir, entry.name);
   if (entry.isDirectory()) walk(filename);
   else if (filename.endsWith('.svelte'))
    for (const line of unreviewedCuts(fs.readFileSync(filename, 'utf8'))) failures.push(`${filename.split(path.sep).join('/')}:${line}`);
  }
 }
 walk('apps/web/src');
 assert.deepEqual(failures, []);
});

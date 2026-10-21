import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Icons are drawn (Icon.svelte, one stroke and weight), never typed: an emoji or a
// dingbat renders differently on every platform and reads aloud as its character name.
// Copy that the application sends (notifications, messages) lives in TypeScript, not here.
const GLYPH = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}\u{231A}-\u{23FF}\u{25A0}-\u{25FF}]/u;

function glyphs(text) {
 return text.split('\n').flatMap((line, index) => (GLYPH.test(line) ? [`${index + 1}`] : []));
}

test('views draw their icons instead of typing glyphs', () => {
 assert.deepEqual(glyphs('<span aria-hidden="true">🔔</span>'), ['1']);
 assert.deepEqual(glyphs('<button>✓ Enviado</button>\n<p>Turno confirmado</p>'), ['1']);
 assert.deepEqual(glyphs('<Icon name="bell" /> Activar recordatorio'), []);
 const failures = [];
 function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   const filename = path.join(dir, entry.name);
   if (entry.isDirectory()) walk(filename);
   else if (filename.endsWith('.svelte'))
    for (const line of glyphs(fs.readFileSync(filename, 'utf8'))) failures.push(`${filename.split(path.sep).join('/')}:${line}`);
  }
 }
 walk('apps/web/src');
 assert.deepEqual(failures, []);
});

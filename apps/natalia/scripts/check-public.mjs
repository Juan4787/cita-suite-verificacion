import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const html = readFileSync(dist + 'index.html', 'utf8');
// This contract protects the full public reference, including the sections lost in the first port.
const sections = ['inicio', 'senales', 'areas', 'como-trabajo', 'sobre-mi', 'cursos', 'notas', 'testimonios', 'preguntas', 'contacto'];
assert.deepEqual([...html.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]), sections, 'The complete public reference must remain present, in order.');
for (const [name, count] of [['signal-card', 6], ['service-card', 4], ['editorial-card', 3], ['test-card', 3], ['cred-item', 3]]) {
  assert.equal([...html.matchAll(new RegExp(`class="(?:[^\"]* )?${name}(?: [^\"]*)?"`, 'g'))].length, count, `${name} content was removed.`);
}
assert.equal((html.match(/class="y"/g) || []).length, 10, 'All ten training entries must be supplied.');
assert.equal((html.match(/<details\b/g) || []).length, 6, 'The six original public questions must remain.');
assert.equal((html.match(/class="footer-col"/g) || []).length, 3, 'The complete four-column footer must remain.');
assert.equal((html.match(/class="public-dialog"/g) || []).length, 12, 'All clinical, editorial, course and contact actions must have a dialog.');
assert(!/onclick=|data-wa\b|api\.whatsapp|Credenciales cita suite|555-1234|subilos en formato PDF|appState/.test(html), 'A mock action or excluded capability was reintroduced.');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
assert.equal(ids.size, [...html.matchAll(/\sid="([^"]+)"/g)].length, 'Public IDs must be unique.');
for (const m of html.matchAll(/<a\b[^>]*href="(#[^"]+|\/[^"?#]*)(?:[?#][^"]*)?"/g)) {
  if (m[1].startsWith('#')) assert(ids.has(m[1].slice(1)), 'Broken public section link: ' + m[1]);
  else assert(existsSync(dist + m[1].replace(/^\//, '') + (m[1].endsWith('/') ? 'index.html' : '/index.html')), 'Missing public destination: ' + m[1]);
}
for (const m of html.matchAll(/data-dialog="([^"]+)"/g)) assert(ids.has(m[1]), 'Missing dialog for a public action: ' + m[1]);
console.log('Public fidelity contract passed: 10 sections, 4 consultations, 3 courses, 3 complete notes, 3 testimonials, 10 training entries, 6 questions, navigation, footer and all public destinations.');

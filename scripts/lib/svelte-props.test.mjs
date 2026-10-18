import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from '../../apps/web/node_modules/typescript/lib/typescript.js';

function untypedProps(text) {
 const failures = [];
 for (const script of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  const source = ts.createSourceFile('component.ts', script[1], ts.ScriptTarget.Latest, true);
  function visit(node) {
   if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) &&
    node.initializer.expression.getText(source) === '$props' && (!node.type || node.initializer.typeArguments?.length))
    failures.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
   ts.forEachChild(node, visit);
  }
  visit(source);
 }
 return failures;
}
test('props have a binding annotation so Svelte checks internals as well as the external component signature', () => {
 assert.deepEqual(untypedProps('<script lang="ts">let {value}: {value:string} = $props();</script>'), []);
 for (const sample of ['let {value} = $props<{value:string}>();', 'let {value} = $props();'])
  assert.equal(untypedProps(`<script lang="ts">${sample}</script>`).length, 1);
 const failures = [];
 function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   const filename = path.join(dir, entry.name);
   if (entry.isDirectory()) walk(filename);
   else if (filename.endsWith('.svelte')) for (const line of untypedProps(fs.readFileSync(filename, 'utf8')))
    failures.push(`${filename}:${line}`);
  }
 }
 walk('apps/web/src');
 assert.deepEqual(failures, []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from '../../apps/web/node_modules/typescript/lib/typescript.js';

function unsafeDiagnostics(text, filename) {
 const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
 const failures = [];
 function visit(node) {
  if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) &&
   node.expression.expression.getText(source) === 'console') {
   const args = node.arguments;
   if (args.length !== 1 || !ts.isStringLiteralLike(args[0])) failures.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
  }
  ts.forEachChild(node, visit);
 }
 visit(source); return failures;
}
test('server diagnostics cannot bypass metadata redaction with raw error objects, templates or console aliases', () => {
 assert.deepEqual(unsafeDiagnostics("console.error('static label');", 'synthetic.ts'), []);
 for (const sample of ["console.error('label', error)", 'console.warn(error)', 'console.error(`patient ${patient.name}`)', "console['error'](error)"])
  assert.equal(unsafeDiagnostics(sample, 'synthetic.ts').length, 1);
 const failures = [];
 function walk(filename) {
  if (fs.statSync(filename).isDirectory()) { for (const item of fs.readdirSync(filename)) walk(path.join(filename, item)); return; }
  if (!filename.endsWith('.ts') || filename.endsWith('.test.ts') || filename.endsWith('/platform/logging.ts')) return;
  for (const line of unsafeDiagnostics(fs.readFileSync(filename, 'utf8'), filename)) failures.push(`${filename}:${line}`);
 }
 for (const root of ['apps/web/src/lib/server', 'apps/web/src/routes', 'apps/web/src/hooks.server.ts']) walk(root);
 assert.deepEqual(failures, []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from '../../apps/web/node_modules/typescript/lib/typescript.js';

// The plan fixes type escapes at their origin: no `any` and no double assertion through
// `unknown` in application code, so a compiler pass cannot hide an incompatibility.
function typeEscapes(text, filename) {
 const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
 const failures = [];
 const line = node => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
 function visit(node) {
  if (node.kind === ts.SyntaxKind.AnyKeyword) failures.push(line(node));
  if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && node.type.kind !== ts.SyntaxKind.UnknownKeyword) {
   let inner = node.expression;
   while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
   if ((ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) && inner.type.kind === ts.SyntaxKind.UnknownKeyword) failures.push(line(node));
  }
  ts.forEachChild(node, visit);
 }
 visit(source); return failures;
}
const scriptsOf = text => [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);

test('application code has no any and no double assertion through unknown', () => {
 assert.deepEqual(typeEscapes('const value: string = input as string; const safe = input as unknown;', 'synthetic.ts'), []);
 for (const sample of ['let value: any;', 'const list: any[] = [];', 'const value = input as any;', 'const value = input as unknown as string;',
  'const value = (input as unknown) as string;', 'const value = <string><unknown>input;'])
  assert.equal(typeEscapes(sample, 'synthetic.ts').length, 1, sample);
 const failures = [];
 function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   const filename = path.join(dir, entry.name);
   if (entry.isDirectory()) walk(filename);
   // Tests may build deliberately invalid values; `.typecheck.ts` asserts what the compiler rejects.
   else if (filename.endsWith('.ts') && !/\.(test|typecheck)\.ts$/.test(filename) && !filename.endsWith('.d.ts'))
    for (const item of typeEscapes(fs.readFileSync(filename, 'utf8'), filename)) failures.push(`${filename}:${item}`);
   else if (filename.endsWith('.svelte'))
    for (const script of scriptsOf(fs.readFileSync(filename, 'utf8')))
     for (const item of typeEscapes(script, filename)) failures.push(`${filename}:${item}`);
  }
 }
 walk('apps/web/src');
 assert.deepEqual(failures, []);
});

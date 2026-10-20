import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { psqlDiagnostics, stagingConnection, stagingPsql } from './staging-database.mjs';

const WARNING = 'psql:<stdin>:138: WARNING:  WarnSendingBroadcastMessage: no partition of relation "messages" found for row';

test('a bulk statement that prints more warnings than a pipe holds still runs to its end, and its error comes first', () => {
	// A stand-in for psql: about 11 MB of the warnings a hosted Realtime prints per row, then an error.
	const directory = mkdtempSync(join(tmpdir(), 'cita-fake-psql-'));
	try {
		writeFileSync(join(directory, 'psql'), `#!${process.execPath}
let chunk = '';
for (let index = 0; index < 1000; index++) chunk += ${JSON.stringify(WARNING)} + '\\n';
for (let index = 0; index < 100; index++) process.stderr.write(chunk);
process.stderr.write('psql:<stdin>:138: ERROR:  CAPACITY_TEST_FAILURE\\nCONTEXT:  PL/pgSQL function pg_temp.capacity_seed() line 9 at SQL statement\\n');
process.stdout.write('partial\\n');
process.exitCode = 3;
`);
		chmodSync(join(directory, 'psql'), 0o755);
		const url = stagingConnection('postgresql://postgres.ikaudqoilclfnztkxubz:not-a-secret@aws-1-us-west-2.pooler.supabase.com:5432/postgres');
		const path = process.env.PATH;
		process.env.PATH = directory;
		let result;
		try { result = stagingPsql(url, ['-f', '-'], { input: 'select 1;' }); } finally { process.env.PATH = path; }
		assert.equal(result.error, undefined, 'psql was not stopped by a full buffer');
		assert.equal(result.status, 3);
		assert.equal(result.stdout, 'partial\n');
		const lines = psqlDiagnostics(result.stderr).split('\n');
		assert.deepEqual(lines.slice(0, 2), ['psql:<stdin>:138: ERROR:  CAPACITY_TEST_FAILURE',
			'CONTEXT:  PL/pgSQL function pg_temp.capacity_seed() line 9 at SQL statement']);
		// Each repeated warning appears once, with how many times it was printed.
		assert.deepEqual(lines.slice(2), ['100000 × WARNING:  WarnSendingBroadcastMessage: no partition of relation "messages" found for row']);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test('diagnostics keep only psql messages and never more than a bounded summary', () => {
	const text = ['ignored output line', ...Array.from({ length: 30 }, (_, index) => `psql:<stdin>:${index}: WARNING:  distinct warning ${index}`),
		'psql: error: connection to server failed: FATAL:  password authentication failed for user "postgres.ikaudqoilclfnztkxubz"'].join('\n');
	const lines = psqlDiagnostics(text).split('\n');
	assert.equal(lines[0], 'psql: error: connection to server failed: FATAL:  password authentication failed for user "postgres.ikaudqoilclfnztkxubz"');
	assert.equal(lines.length, 1 + 5 + 1);
	assert.equal(lines.at(-1), '… 25 more distinct warnings');
	assert.ok(!lines.includes('ignored output line'));
	assert.equal(psqlDiagnostics(''), '');
});

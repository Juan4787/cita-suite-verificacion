import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	COMPACTION_MIN_BYTES, changedTables, compactionCandidatesSql, compactionScript, qualifiedTable, tableDigestsSql, tableSizesSql, vacuumCandidatesSql,
	vacuumScript
} from './table-maintenance.mjs';

test('only the application tables of the maintenance role, from the threshold up, are compaction candidates', () => {
	const sql = compactionCandidatesSql();
	assert.match(sql, /c\.relkind = 'r'/);
	assert.match(sql, /n\.nspname in \('public', 'private'\)/);
	assert.match(sql, /c\.relowner = \(select oid from pg_roles where rolname = current_user\)/);
	assert.match(sql, new RegExp(`>= ${COMPACTION_MIN_BYTES}$`));
	assert.match(compactionCandidatesSql(0), />= 0$/);
	for (const value of [-1, 1.5, '1000', Number.NaN]) assert.throws(() => compactionCandidatesSql(value), /Invalid compaction threshold/);
	assert.match(vacuumCandidatesSql, /n_ins_since_vacuum > 0 or s\.n_mod_since_analyze > 0 or s\.n_dead_tup > 0/);
	assert.match(vacuumCandidatesSql, /c\.relowner = \(select oid from pg_roles where rolname = current_user\)/);
});

test('table names are accepted only as the catalog prints the application tables', () => {
	for (const name of ['public.appointments', 'private.business_secrets', 'public."Mixed Case"', 'public.a$b'])
		assert.equal(qualifiedTable(name), name);
	for (const name of ['appointments', 'auth.users', 'storage.objects', 'realtime.messages', 'public.appointments; drop table public.patients',
		'public.appointments t, public.patients', 'public."a"b"', 'public.Appointments', ' public.appointments', 'public.', undefined, null, 1])
		assert.throws(() => qualifiedTable(name), /Refused table name/);
});

test('the digest covers every table by count and ordered content, and refuses a foreign name before building SQL', () => {
	const sql = tableDigestsSql(['public.appointments', 'public.patients']);
	assert.match(sql, /'public\.appointments', \(select jsonb_build_object\('rows', count\(\*\)/);
	assert.match(sql, /from public\.patients t\)/);
	assert.match(sql, /string_agg\(t::text, E'\\n' order by t::text\)/);
	assert.throws(() => tableDigestsSql([]), /No tables to digest/);
	assert.throws(() => tableDigestsSql(['public.appointments', 'auth.users']), /Refused table name/);
	assert.match(tableDigestsSql(["public.\"it's\""]), /'public\."it''s"'/);
});

test('sizes are read for the database and every given table, and only for application tables', () => {
	assert.equal(tableSizesSql(['public.appointments', 'public."it\'s"']), "select jsonb_build_object('databaseBytes', pg_database_size(current_database()), " +
		"'tables', jsonb_build_object('public.appointments', pg_total_relation_size('public.appointments'::regclass), " +
		"'public.\"it''s\"', pg_total_relation_size('public.\"it''s\"'::regclass)))::text");
	assert.throws(() => tableSizesSql([]), /No tables to measure/);
	assert.throws(() => tableSizesSql(['storage.objects']), /Refused table name/);
});

test('a changed, missing or unreadable digest is reported; identical ones are not', () => {
	const digest = { 'public.a': { rows: 2, md5: 'x' }, 'public.b': { rows: 0, md5: 'd41d8cd98f00b204e9800998ecf8427e' } };
	assert.deepEqual(changedTables(digest, structuredClone(digest)), []);
	assert.deepEqual(changedTables(digest, { ...digest, 'public.a': { rows: 2, md5: 'y' } }), ['public.a']);
	assert.deepEqual(changedTables(digest, { ...digest, 'public.a': { rows: 3, md5: 'x' } }), ['public.a']);
	assert.deepEqual(changedTables(digest, { 'public.a': digest['public.a'] }), ['public.b']);
	assert.deepEqual(changedTables({ 'public.a': { rows: 2 } }, { 'public.a': { rows: 2 } }), ['public.a']);
	assert.deepEqual(changedTables(undefined, digest), ['public.a', 'public.b']);
});

test('the rewrite runs one statement per table behind a lock timeout; vacuum is one statement or nothing', () => {
	assert.equal(compactionScript(['public.appointments', 'public.patients']), "set lock_timeout = '5s';\nset statement_timeout = '120s';\n" +
		'vacuum (full, analyze) public.appointments;\nvacuum (full, analyze) public.patients;\n');
	assert.throws(() => compactionScript([]), /No tables to compact/);
	assert.throws(() => compactionScript(['public.appointments', 'cron.job']), /Refused table name/);
	assert.equal(vacuumScript([]), '');
	assert.equal(vacuumScript(['public.appointments', 'public.patients']), "set statement_timeout = '300s';\nvacuum (analyze) public.appointments, public.patients;\n");
	assert.throws(() => vacuumScript(['public.appointments', 'auth.users']), /Refused table name/);
});

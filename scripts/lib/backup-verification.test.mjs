import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyRowCounts, countMismatches, objectMismatches } from './backup-verification.mjs';

test('a data dump is counted by its COPY blocks, with quoted names and escaped newlines', () => {
	const dump = [
		'SET session_replication_role = replica;',
		'COPY "auth"."users" ("id", "email") FROM stdin;',
		'1\tuno@example.test',
		'2\tdos@example.test',
		'\\.',
		'COPY public.patients (id, full_name, notes) FROM stdin;',
		'3\tPaciente\tPrimera línea\\nSegunda línea',
		'\\.',
		'COPY "public"."empty table" ("id") FROM stdin;',
		'\\.',
		''
	].join('\n');
	assert.deepEqual(copyRowCounts(dump), { 'auth.users': 2, 'public.patients': 1, 'public.empty table': 0 });
	assert.throws(() => copyRowCounts('COPY public.patients (id) FROM stdin;\n1\n'), /ends inside the COPY block/);
});

test('a restore that lost, added or missed rows or tables is reported', () => {
	assert.deepEqual(countMismatches({ 'public.a': 2, 'public.b': 0 }, { 'public.a': 2, 'public.b': 0 }), []);
	assert.deepEqual(countMismatches({ 'public.a': 2, 'public.b': 1 }, { 'public.a': 1, 'public.c': 4 }), [
		{ table: 'public.a', expected: 2, actual: 1 },
		{ table: 'public.b', expected: 1, actual: null },
		{ table: 'public.c', expected: null, actual: 4 }
	]);
});

test('a stored object that was not downloaded whole is reported', () => {
	const objects = [
		{ bucket: 'patient-clinical-files', name: 'a/1.pdf', size: 10 },
		{ bucket: 'patient-clinical-files', name: 'a/2.pdf', size: 20 },
		{ bucket: 'patient-clinical-files', name: 'a/3.pdf', size: 30 }
	];
	const downloads = new Map([
		['patient-clinical-files/a/1.pdf', { bytes: 10, sha256: 'x' }],
		['patient-clinical-files/a/2.pdf', { bytes: 19, sha256: 'y' }]
	]);
	assert.deepEqual(objectMismatches(objects, downloads), [
		{ object: 'patient-clinical-files/a/2.pdf', expected: 20, actual: 19 },
		{ object: 'patient-clinical-files/a/3.pdf', expected: 30, actual: null }
	]);
});

test('a restore skips what configures the platform roles and keeps the project settings and roles', async () => {
	const { skipPlatformRoleStatements } = await import('./supabase-backup.mjs');
	const { lines, platformRoles } = skipPlatformRoleStatements([
		'ALTER ROLE "anon" SET "statement_timeout" TO \'3s\';',
		'ALTER ROLE "authenticator" SET "pgrst.db_schemas" TO \'public\';',
		'CREATE ROLE "supabase_realtime_admin";',
		'GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";',
		'ALTER ROLE "authenticated" SET "log_min_messages" TO \'fatal\';',
		'GRANT "pg_read_all_data" TO "postgres" WITH INHERIT TRUE GRANTED BY "supabase_admin";',
		'CREATE ROLE "reporting";',
		'GRANT "authenticated" TO "reporting";'
	], new Set(['anon', 'authenticated', 'authenticator', 'postgres']));
	assert.deepEqual(lines, [
		'ALTER ROLE "anon" SET "statement_timeout" TO \'3s\';',
		'ALTER ROLE "authenticator" SET "pgrst.db_schemas" TO \'public\';',
		'-- CREATE ROLE "supabase_realtime_admin";',
		'-- GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";',
		'-- ALTER ROLE "authenticated" SET "log_min_messages" TO \'fatal\';',
		'-- GRANT "pg_read_all_data" TO "postgres" WITH INHERIT TRUE GRANTED BY "supabase_admin";',
		'CREATE ROLE "reporting";',
		'GRANT "authenticated" TO "reporting";'
	]);
	assert.deepEqual([...platformRoles].sort(), ['authenticated', 'postgres', 'supabase_realtime_admin']);
});

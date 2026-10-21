import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { copyRowCounts } from './backup-verification.mjs';

// Backup and restore of a Supabase project as the Supabase guide documents them for Free
// projects, which have no managed daily backups (supabase.com/docs/guides/platform/backups and
// .../migrating-within-supabase/backup-restore), completed with what that guide leaves out and
// the rehearsal proved necessary:
// - managed.sql: the policies, triggers and Realtime publication entries the migrations add to
//   the schemas the platform manages (the schema dump leaves those schemas out);
// - history.sql: the CLI's migration history, which stays out of the dump;
// - objects/: every stored file, named by its SHA-256, since the dump holds none.
// The caller provides the access to each project; nothing here reads credentials.

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// What the migrations add to the platform's schemas, named, to compare a source and a restore.
export const MANAGED_OBJECTS_SQL = `select json_build_object(
	'policies', (select coalesce(json_agg(schemaname || '.' || tablename || ':' || policyname order by 1), '[]'::json)
		from pg_policies where schemaname in ('storage', 'realtime', 'auth')),
	'triggers', (select coalesce(json_agg(n.nspname || '.' || c.relname || ':' || t.tgname order by 1), '[]'::json)
		from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
		join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
		where not t.tgisinternal and n.nspname in ('storage', 'realtime', 'auth') and fn.nspname in ('public', 'private'))
)::text;`;

// The same objects as statements that recreate them, read from the source's catalog.
const MANAGED_DEFINITIONS_SQL = `select json_build_object('statements', coalesce(json_agg(statement order by statement), '[]'::json))::text from (
	select format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;', p.polname, n.nspname, c.relname,
		case when p.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,
		case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
		case when p.polroles = '{0}'::oid[] then 'PUBLIC' else (select string_agg(quote_ident(r.rolname), ', ' order by r.rolname) from pg_roles r where r.oid = any(p.polroles)) end,
		coalesce(' USING (' || pg_get_expr(p.polqual, p.polrelid) || ')', ''),
		coalesce(' WITH CHECK (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')', '')) as statement
	from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
	where n.nspname in ('storage', 'realtime', 'auth')
	union all
	select pg_get_triggerdef(t.oid) || ';'
	from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
	join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
	where not t.tgisinternal and n.nspname in ('storage', 'realtime', 'auth') and fn.nspname in ('public', 'private')
	union all
	select format('ALTER PUBLICATION %I ADD TABLE %I.%I;', pubname, schemaname, tablename)
	from pg_publication_tables where pubname = 'supabase_realtime' and schemaname in ('public', 'private')
) definitions;`;

export const HISTORY_SQL = `select coalesce(json_agg(json_build_array(version, name) order by version), '[]'::json)::text
	from supabase_migrations.schema_migrations;`;

const OBJECTS_SQL = `select coalesce(json_agg(json_build_object('bucket', bucket_id, 'name', name, 'size', (metadata->>'size')::bigint)
	order by bucket_id, name), '[]'::json)::text from storage.objects;`;

const literal = (text) => (text === null ? 'null' : `'${String(text).replaceAll("'", "''")}'`);

/**
 * Writes a complete backup into `directory` and returns its manifest, also saved as
 * manifest.json. `dump(args)` runs `supabase db dump --db-url <source>` with args;
 * `readJson(sql)` runs a read-only query on the source and parses its JSON value;
 * `storageGet(bucket, name)` returns `{ body, contentType }` of a stored file.
 */
export async function createSupabaseBackup({ directory, source, dump, readJson, storageGet }) {
	mkdirSync(join(directory, 'objects'), { recursive: true, mode: 0o700 });
	const files = Object.fromEntries(['roles', 'schema', 'data', 'managed', 'history'].map((name) => [name, join(directory, `${name}.sql`)]));
	const started = performance.now();
	dump(['-f', files.roles, '--role-only']);
	dump(['-f', files.schema]);
	dump(['-f', files.data, '--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes']);
	writeFileSync(files.managed, readJson(MANAGED_DEFINITIONS_SQL).statements.join('\n') + '\n', { mode: 0o600 });
	const history = readJson(HISTORY_SQL);
	writeFileSync(files.history, ['create schema if not exists supabase_migrations;',
		'create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);',
		...history.map(([version, name]) => `insert into supabase_migrations.schema_migrations (version, name) values (${literal(version)}, ${literal(name)});`)
	].join('\n') + '\n', { mode: 0o600 });
	const objects = [];
	const objectFailures = [];
	for (const { bucket, name, size } of readJson(OBJECTS_SQL)) {
		try {
			const { body, contentType } = await storageGet(bucket, name);
			const hash = sha256(body);
			writeFileSync(join(directory, 'objects', hash), body, { mode: 0o600 });
			objects.push({ bucket, name, contentType, recordedBytes: size, bytes: body.length, sha256: hash });
		} catch (error) {
			objectFailures.push({ object: `${bucket}/${name}`, reason: error.message });
		}
	}
	const manifest = {
		createdAt: new Date().toISOString(),
		source,
		dumpMs: Math.round(performance.now() - started),
		files: Object.fromEntries(Object.entries(files).map(([name, path]) => [name, { bytes: statSync(path).size, sha256: sha256(readFileSync(path)) }])),
		rows: copyRowCounts(readFileSync(files.data, 'utf8')),
		migrations: history,
		managed: readJson(MANAGED_OBJECTS_SQL),
		objects,
		objectFailures
	};
	writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
	return manifest;
}

/**
 * Restores a backup into a new project. Its files are checked against the manifest first.
 * `existingRoles` are the roles of the new project before the restore; `psql(files)` runs the
 * guide's restore command in one transaction with the given prepared files; `storagePut(file,
 * body)` stores a file in the new project.
 */
export async function restoreSupabaseBackup({ directory, existingRoles, psql, storagePut }) {
	const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
	for (const [name, file] of Object.entries(manifest.files))
		if (sha256(readFileSync(join(directory, `${name}.sql`))) !== file.sha256) throw new Error(`The backup file ${name}.sql does not match its manifest.`);
	for (const object of manifest.objects)
		if (sha256(readFileSync(join(directory, 'objects', object.sha256))) !== object.sha256) throw new Error('A stored file of the backup does not match its manifest.');

	const { lines: roles, platformRoles } = skipPlatformRoleStatements(readFileSync(join(directory, 'roles.sql'), 'utf8').split('\n'), existingRoles);
	const ownership = /^ALTER .* OWNER TO "supabase_admin";$/;
	const schema = readFileSync(join(directory, 'schema.sql'), 'utf8').split('\n');
	const prepared = { roles: join(directory, 'roles.restore.sql'), schema: join(directory, 'schema.restore.sql') };
	writeFileSync(prepared.roles, roles.join('\n'), { mode: 0o600 });
	writeFileSync(prepared.schema, schema.map((line) => (ownership.test(line) ? '-- ' + line : line)).join('\n'), { mode: 0o600 });
	const fixes = {
		platformRoleStatements: roles.filter((line) => /^-- (CREATE ROLE|ALTER ROLE|GRANT) /.test(line)).length,
		platformRoles: [...platformRoles].sort(),
		ownRoleStatements: roles.filter((line) => /^(CREATE ROLE|ALTER ROLE|GRANT) /.test(line)).length,
		supabaseAdminOwnership: schema.filter((line) => ownership.test(line)).length
	};

	const started = performance.now();
	psql({ ...prepared, data: join(directory, 'data.sql'), managed: join(directory, 'managed.sql'), history: join(directory, 'history.sql') });
	const restoreMs = Math.round(performance.now() - started);
	for (const object of manifest.objects)
		await storagePut(object, readFileSync(join(directory, 'objects', object.sha256)));
	return { manifest, fixes, restoreMs };
}

/**
 * A new project defines the platform's roles itself. As the CLI does for the roles it reserves,
 * a statement that creates a platform role, grants it anything, or alters one is skipped; the
 * settings the CLI restores on purpose (statement_timeout, pgrst.*) stay. Platform roles: those
 * the new project already has, and the reserved supabase_* and pg_* ones (a dump grants
 * Realtime's supabase_realtime_admin a parameter the CLI does not reserve).
 */
export function skipPlatformRoleStatements(lines, existingRoles) {
	const platform = (role) => existingRoles.has(role) || /^(supabase_|pg_)/.test(role);
	const restorableSetting = /^ALTER ROLE "(?:[^"]|"")+" SET "(statement_timeout|pgrst\.[^"]+)" /;
	const platformRoles = new Set();
	const kept = lines.map((line) => {
		const created = /^CREATE ROLE "((?:[^"]|"")+)"/.exec(line)?.[1];
		const grantee = /^GRANT .+ TO "((?:[^"]|"")+)"/.exec(line)?.[1];
		const altered = restorableSetting.test(line) ? null : /^ALTER ROLE "((?:[^"]|"")+)"/.exec(line)?.[1];
		const role = (created ?? grantee ?? altered)?.replaceAll('""', '"');
		if (!role || !platform(role)) return line;
		platformRoles.add(role);
		return '-- ' + line;
	});
	return { lines: kept, platformRoles };
}

/** The psql arguments of the guide's restore, with the files this backup adds, in one transaction. */
export const restoreArguments = (paths) => ['--single-transaction', '-v', 'ON_ERROR_STOP=1', '-q',
	'-f', paths.roles, '-f', paths.schema, '-c', 'SET session_replication_role = replica', '-f', paths.data,
	'-c', 'SET session_replication_role = origin', '-f', paths.managed, '-f', paths.history];

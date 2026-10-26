// Maintenance of the project's own tables on a hosted project, for scripts/production-capacity.mjs.
// A synthetic load leaves its space behind: deleting rows does not shrink a table or its indexes,
// and Supabase Free counts that space against its 500 MB. `compact` rewrites the tables that hold
// it (VACUUM FULL) and proves their content did not change; `vacuum` leaves a fresh seed vacuumed
// and analyzed, as a database in steady use would be, before it is measured.

/** Tables smaller than this are left as they are: rewriting them recovers nothing worth a lock. */
export const COMPACTION_MIN_BYTES = 1_000_000;

// The tables of the role that runs the maintenance, in the application's schemas. Supabase's own
// schemas belong to other roles and are not touched.
const OWN_TABLES = `from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'r' and n.nspname in ('public', 'private') and c.relowner = (select oid from pg_roles where rolname = current_user)`;

/** JSON array of the own tables at least `minBytes` long on disk, each with its size. */
export const compactionCandidatesSql = (minBytes = COMPACTION_MIN_BYTES) => {
	if (!Number.isSafeInteger(minBytes) || minBytes < 0) throw new Error('Invalid compaction threshold.');
	return `select coalesce(jsonb_agg(jsonb_build_object('table', format('%I.%I', n.nspname, c.relname), 'bytes', pg_total_relation_size(c.oid))
 order by pg_total_relation_size(c.oid) desc), '[]'::jsonb)::text ${OWN_TABLES} and pg_total_relation_size(c.oid) >= ${minBytes}`;
};

/** JSON array of the own tables changed since their last vacuum or analyze. */
export const vacuumCandidatesSql = `select coalesce(jsonb_agg(format('%I.%I', n.nspname, c.relname) order by c.relname), '[]'::jsonb)::text
 ${OWN_TABLES} and exists (select 1 from pg_stat_user_tables s where s.relid = c.oid
 and (s.n_ins_since_vacuum > 0 or s.n_mod_since_analyze > 0 or s.n_dead_tup > 0))`;

// A name as format('%I.%I') prints it for the application's schemas: bare lowercase identifiers,
// or quoted ones without quotes inside. Anything else is refused before it reaches SQL.
const IDENTIFIER = '(?:[a-z_][a-z0-9_$]*|"[^"\\u0000]+")';
const QUALIFIED = new RegExp(`^(?:public|private)\\.${IDENTIFIER}$`);

/** The qualified name, refused unless it is one of the application's tables as the catalog prints it. */
export function qualifiedTable(name) {
	if (typeof name !== 'string' || !QUALIFIED.test(name)) throw new Error(`Refused table name: ${JSON.stringify(name)}.`);
	return name;
}

/**
 * Row count and a digest of the content of each table, as one JSON object. Rows are compared as
 * text in a fixed order: a rewrite moves them, so their physical order is not part of the content.
 */
export function tableDigestsSql(tables) {
	if (!Array.isArray(tables) || tables.length === 0) throw new Error('No tables to digest.');
	return `select jsonb_build_object(${tables.map((table) => `'${qualifiedTable(table).replaceAll("'", "''")}', (select jsonb_build_object('rows', count(*),
 'md5', md5(coalesce(string_agg(t::text, E'\\n' order by t::text), ''))) from ${table} t)`).join(',\n ')})::text`;
}

/** The database's size and the size on disk of each table, indexes and TOAST included, as one JSON object. */
export function tableSizesSql(tables) {
	if (!Array.isArray(tables) || tables.length === 0) throw new Error('No tables to measure.');
	return `select jsonb_build_object('databaseBytes', pg_database_size(current_database()), 'tables', jsonb_build_object(${tables.map((table) => {
		const literal = `'${qualifiedTable(table).replaceAll("'", "''")}'`;
		return `${literal}, pg_total_relation_size(${literal}::regclass)`;
	}).join(', ')}))::text`;
}

/** The tables whose content differs between two digests, or that one of them lacks. */
export function changedTables(before, after) {
	const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
	return [...names].sort().filter((name) => before?.[name]?.rows !== after?.[name]?.rows || before?.[name]?.md5 !== after?.[name]?.md5 ||
		typeof before?.[name]?.md5 !== 'string');
}

/**
 * One statement per table, each in its own transaction: VACUUM cannot run inside one. A lock that
 * is not granted within the timeout stops the rewrite instead of queueing the application behind it.
 */
export function compactionScript(tables) {
	if (!Array.isArray(tables) || tables.length === 0) throw new Error('No tables to compact.');
	return `set lock_timeout = '5s';\nset statement_timeout = '120s';\n` +
		tables.map((table) => `vacuum (full, analyze) ${qualifiedTable(table)};`).join('\n') + '\n';
}

/** VACUUM (ANALYZE) of the given tables in one statement, or nothing when there are none. */
export const vacuumScript = (tables) => tables.length === 0 ? '' : `set statement_timeout = '300s';\nvacuum (analyze) ${tables.map(qualifiedTable).join(', ')};\n`;

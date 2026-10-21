// Checks of a backup made the way Supabase documents it (`supabase db dump`: roles, schema,
// and data with --use-copy) and of its restore into another database. They compare counts
// and fingerprints, never the content of the rows or files.

const unquote = (identifier) => identifier.replace(/^"(.*)"$/, '$1').replaceAll('""', '"');

/**
 * Rows of each table in a data-only dump: every `COPY schema.table (...) FROM stdin;`
 * block holds one row per line (COPY escapes newlines inside values) and ends with `\.`.
 */
export function copyRowCounts(text) {
	const counts = {};
	let table = null;
	for (const line of text.split('\n')) {
		if (table === null) {
			const match = /^COPY ((?:"(?:[^"]|"")+"|[\w$]+)\.(?:"(?:[^"]|"")+"|[\w$]+)) \(.*\) FROM stdin;$/.exec(line);
			if (!match) continue;
			const [schema, name] = match[1].match(/"(?:[^"]|"")+"|[\w$]+/g);
			table = `${unquote(schema)}.${unquote(name)}`;
			counts[table] ??= 0;
			continue;
		}
		if (line === '\\.') table = null;
		else counts[table] += 1;
	}
	if (table !== null) throw new Error(`The data dump ends inside the COPY block of ${table}.`);
	return counts;
}

/** Tables whose restored row count differs from the dump, including tables missing on either side. */
export function countMismatches(expected, actual) {
	const tables = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
	return tables
		.filter((table) => expected[table] !== actual[table])
		.map((table) => ({ table, expected: expected[table] ?? null, actual: actual[table] ?? null }));
}

/**
 * Stored objects whose download is missing or does not match the size the database records.
 * `objects` come from storage.objects; `downloads` map `bucket/name` to the bytes received.
 */
export function objectMismatches(objects, downloads) {
	return objects
		.filter(({ bucket, name, size }) => downloads.get(`${bucket}/${name}`)?.bytes !== size)
		.map(({ bucket, name, size }) => ({
			object: `${bucket}/${name}`,
			expected: size,
			actual: downloads.get(`${bucket}/${name}`)?.bytes ?? null
		}));
}

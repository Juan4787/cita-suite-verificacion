/**
 * One condition of a PostgREST logic tree, `or(...)`, matching `term` anywhere in
 * `column`. LIKE wildcards in the term are escaped so it matches as written, and the
 * value is quoted so a comma or a parenthesis stays text instead of ending the
 * condition. Inside quotes PostgREST reads `\x` as `x`, hence the doubled backslashes.
 * PostgREST still reads `*` as a wildcard in like patterns.
 */
export const ilikeContains = (column: string, term: string): string => {
	const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
	return `${column}.ilike."${pattern.replace(/[\\"]/g, '\\$&')}"`;
};

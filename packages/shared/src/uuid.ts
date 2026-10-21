// One definition of an identifier for every app: the canonical hyphenated form that
// PostgreSQL stores, of any version. Checked before an id reaches a query or a filter tree.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
	typeof value === 'string' && UUID_PATTERN.test(value);

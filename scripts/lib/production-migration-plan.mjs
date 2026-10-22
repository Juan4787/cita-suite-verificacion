import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = /^\d{14}_[a-z0-9_]+\.sql$/;
const RECONCILIATION = 'supabase/production/reconcile-drift.sql';
// The first pending migration that production's drift breaks: the reconciliation runs with it, once.
export const FIRST_RECONCILED_MIGRATION = '20261016010000_tenant_relation_identity.sql';

/**
 * Production's pending database changes as one transaction: the reconciliation of its drift, each
 * pending migration without its own transaction lines, then their history. All of it applies, or
 * nothing does. `until` limits a batch to the migrations up to that version, so a release can
 * expand before its deployment and contract after it. `finish` closes it: `commit` publishes,
 * `rollback` rehearses; `before` and `after` hold psql settings and the rehearsal's catalog reading.
 * Ranges map script lines to their source.
 */
export function productionTransaction(root, applied, { finish, before = '', after = '', until = null }) {
	if (!['commit', 'rollback'].includes(finish)) throw new Error('A production transaction ends in commit or rollback.');
	const files = readdirSync(join(root, 'supabase/migrations')).filter(name => MIGRATION.test(name)).sort();
	if (applied.some((version, index) => !files[index]?.startsWith(version + '_')))
		throw new Error('Production history is not a prefix of the versioned migrations. Nothing was sent.');
	if (until !== null && !/^\d{14}$/.test(until)) throw new Error('A batch ends at an exact migration version.');
	const pending = files.slice(applied.length).filter(name => until === null || name.slice(0, 14) <= until);
	if (!pending.length) throw new Error('No pending migration in this batch. Nothing was sent.');
	const lines = [...(before ? before.split('\n') : []), 'begin;', "set local lock_timeout = '5s';", "set local statement_timeout = '120s';"];
	const ranges = [];
	const add = (name, text) => {
		const start = lines.length + 1;
		lines.push(...text.split('\n'));
		ranges.push({ name, start, end: lines.length });
	};
	if (pending.includes(FIRST_RECONCILED_MIGRATION)) add(RECONCILIATION, readFileSync(join(root, RECONCILIATION), 'utf8'));
	for (const name of pending) {
		const source = readFileSync(join(root, 'supabase/migrations', name), 'utf8').split('\n');
		const control = source.map((line, index) => /^\s*(begin|commit)\s*;\s*$/i.exec(line) && index).filter(index => index !== null);
		const statements = source.map((line, index) => /^\s*(--.*)?$/.test(line) ? null : index).filter(index => index !== null);
		// Its own transaction is a begin as its first statement and a commit as its last, or none at all.
		const own = control.length === 0 || (control.length === 2 && control[0] === statements[0] && control[1] === statements.at(-1) &&
			/begin/i.test(source[control[0]]) && /commit/i.test(source[control[1]]));
		const body = source.filter((_, index) => !control.includes(index)).join('\n');
		// Outside dollar-quoted bodies, no other statement may close the shared transaction.
		if (!own || /^\s*(commit|rollback|end|abort)\s*;/im.test(body.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, '')))
			throw new Error(`${name} holds transaction control outside its own lines. Nothing was sent.`);
		add(name, body);
	}
	add('history', pending.map(name =>
		`insert into supabase_migrations.schema_migrations(version, name) values ('${name.slice(0, 14)}', '${name.slice(15, -4)}');`).join('\n'));
	if (after) lines.push(...after.split('\n'));
	lines.push(`${finish};`);
	return { script: lines.join('\n') + '\n', ranges, pending };
}

/** The source of a psql error line in the script. */
export const sourceOf = (ranges, line) => ranges.find(range => line >= range.start && line <= range.end)?.name ?? 'transaction';

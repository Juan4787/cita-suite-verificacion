import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The only SQL target these scripts accept: the session pooler of the dedicated
// staging project. Never inferred from .env or a CLI link.
export const STAGING_PROJECT_REF = 'ikaudqoilclfnztkxubz';

export function stagingConnection(value) {
	let url;
	try { url = new URL(value); } catch { throw new Error('The explicit staging connection is invalid. No connection was attempted.'); }
	if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
		url.hostname !== 'aws-1-us-west-2.pooler.supabase.com' ||
		decodeURIComponent(url.username) !== `postgres.${STAGING_PROJECT_REF}` ||
		url.port !== '5432' || url.pathname !== '/postgres' || !url.password)
		throw new Error('The connection does not match the authorized staging project. No connection was attempted.');
	return url;
}

/**
 * psql against staging; the password travels only in the environment, never in arguments or output.
 * Its messages go to a private temporary file, not to a pipe: a bulk statement prints a warning per
 * row when hosted Realtime cannot store a broadcast, more than any pipe buffer holds, and a full
 * buffer would stop psql in the middle of its work.
 */
export function stagingPsql(url, args, { input, options = '', timeout = 300_000 } = {}) {
	const directory = mkdtempSync(join(tmpdir(), 'cita-staging-psql-'));
	const messages = join(directory, 'messages');
	const descriptor = openSync(messages, 'w', 0o600);
	try {
		const result = spawnSync('psql', ['-X', '-h', url.hostname, '-p', url.port, '-U', decodeURIComponent(url.username),
			'-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], {
			input, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 ** 2, stdio: ['pipe', 'pipe', descriptor],
			env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10',
				PGOPTIONS: options }
		});
		return { ...result, stderr: readFileSync(messages, 'utf8') };
	} finally {
		closeSync(descriptor);
		rmSync(directory, { recursive: true, force: true });
	}
}

/**
 * Only psql's own messages, which cannot contain the connection secret: the error and its context
 * first, then each distinct warning once with how many times it was printed.
 */
export function psqlDiagnostics(text) {
	const lines = (text ?? '').split('\n').filter(line => /^(psql:|ERROR|FATAL|DETAIL|HINT|CONTEXT|LINE|WARNING)/.test(line));
	const isWarning = line => /^(psql:[^ ]*: )?WARNING:/.test(line);
	const warnings = new Map();
	for (const line of lines.filter(isWarning)) {
		const message = line.replace(/^psql:[^ ]*: /, '');
		warnings.set(message, (warnings.get(message) ?? 0) + 1);
	}
	const summary = [...warnings].slice(0, 5).map(([message, count]) => `${count} × ${message}`);
	if (warnings.size > 5) summary.push(`… ${warnings.size - 5} more distinct warnings`);
	return [...lines.filter(line => !isWarning(line)).slice(0, 20), ...summary].join('\n');
}

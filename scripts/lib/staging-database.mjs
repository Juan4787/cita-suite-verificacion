import { spawnSync } from 'node:child_process';

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

/** psql against staging; the password travels only in the environment, never in arguments or output. */
export function stagingPsql(url, args, { input, options = '', timeout = 300_000 } = {}) {
	return spawnSync('psql', ['-X', '-h', url.hostname, '-p', url.port, '-U', decodeURIComponent(url.username),
		'-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], {
		input, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 ** 2,
		env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10',
			PGOPTIONS: options }
	});
}

/** Only the diagnostic lines of a failure, which cannot contain the connection secret. */
export const psqlDiagnostics = text =>
	(text ?? '').split('\n').filter(line => /^(psql:|ERROR|DETAIL|HINT|CONTEXT|LINE|WARNING)/.test(line)).slice(0, 20).join('\n');

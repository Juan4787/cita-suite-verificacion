import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { psqlDiagnostics } from './staging-database.mjs';

// The production database as the publication, backup and measurement scripts reach it: from this
// machine, with the private configuration in the repository's ignored `.env`, never from CI.
export const PRODUCTION_REF = 'yjzferwuzbtgpmdnzlcb';
export const PRODUCTION_API_ORIGIN = `https://${PRODUCTION_REF}.supabase.co`;

/** KEY=value lines of a private env file; quotes around a value are dropped. */
export const readEnvFile = (path) => Object.fromEntries(readFileSync(path, 'utf8').split('\n')
	.map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter(Boolean)
	.map(([, key, value]) => [key, value.replace(/^["']|["']$/g, '')]));

/**
 * The production session: the project's São Paulo pooler, its own user, the postgres database and
 * a password, on port 5432, the session mode that pg_dump and a multi-statement transaction need.
 * Anything else is refused before any connection, and the error never repeats the value.
 */
export function productionConnection(value) {
	let url;
	try { url = new URL(value); } catch { throw new Error('The production connection is missing or invalid. No connection was attempted.'); }
	if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^aws-\d+-sa-east-1\.pooler\.supabase\.com$/.test(url.hostname) ||
		decodeURIComponent(url.username) !== `postgres.${PRODUCTION_REF}` || url.pathname !== '/postgres' || !url.password)
		throw new Error('The connection is not the production project. No connection was attempted.');
	url.port = '5432';
	return url;
}

const claims = (key) => { try { return JSON.parse(Buffer.from(String(key).split('.')[1], 'base64url').toString('utf8')); } catch { return null; } };

/** The production API keys of the private configuration, each of the project and of its role; never repeated. */
export function productionKeys(env) {
	const serviceKey = env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	const anonKey = env.ODONTO_SUPABASE_ANON_KEY;
	if (env.ODONTO_SUPABASE_URL?.replace(/\/$/, '') !== PRODUCTION_API_ORIGIN || claims(serviceKey)?.ref !== PRODUCTION_REF ||
		claims(serviceKey)?.role !== 'service_role' || claims(anonKey)?.ref !== PRODUCTION_REF || claims(anonKey)?.role !== 'anon')
		throw new Error('The production keys are not the expected ones. Nothing was sent.');
	return { serviceKey, anonKey };
}

/** This machine's production configuration: every variable of `.env` and the checked database session. */
export function productionEnvironment(root) {
	const env = readEnvFile(join(root, '.env'));
	return { env, database: productionConnection(env.SUPABASE_DB_URL) };
}

/**
 * psql on the production session: one script from standard input, stopping at the first error,
 * with the password only in the environment and never in an error. Returns standard output.
 */
export function productionPsql(database, input, { application, args = ['-Atq'], timeout = 120_000 }) {
	const password = decodeURIComponent(database.password);
	const result = spawnSync('psql', ['-X', '-h', database.hostname, '-p', database.port, '-U', decodeURIComponent(database.username), '-d', 'postgres',
		'-v', 'ON_ERROR_STOP=1', ...args, '-f', '-'], {
		input, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 ** 2,
		env: { ...process.env, PGPASSWORD: password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10', PGAPPNAME: application }
	});
	if (result.error || result.status !== 0) throw new Error('The production query failed.\n' + psqlDiagnostics(result.stderr).replaceAll(password, '[secret]'));
	return result.stdout;
}

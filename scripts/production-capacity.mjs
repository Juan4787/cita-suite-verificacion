import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRODUCTION_API_ORIGIN, productionEnvironment } from './lib/production-database.mjs';
import { psqlDiagnostics } from './lib/staging-database.mjs';
import { PRODUCTION_APP_ORIGIN } from './lib/production-deploy.mjs';
import {
	INTEGRITY_SQL, capacityOwnersPassword, createRandom, evaluateAcceptance, login, practiceData, removeCapacityOwners, runPublicAbuse, runPublicGenerator,
	runVirtualUser, summarize, uuidFrom
} from './lib/capacity-load.mjs';

// The two-practice measurement on production, the criterion of the 20 October decision, with
// the generator, virtual users and public generator of the staging measurement. Production's
// database is never reachable from CI: `measure` is only the HTTP load, run from an external
// runner against the public app; `seed`, `integrity`, `report` and `cleanup` run from this
// machine with the private configuration. The synthetic owners' password is derived from a
// secret of this measurement (~/.config/cita-suite/production/capacity-secret, mode 600, also a
// temporary Actions secret), never from a production credential. Every row belongs to a
// `capacity-` practice, and `cleanup` removes them and the owners.
const PRACTICES = 2;
const root = fileURLToPath(new URL('../', import.meta.url));
const [operation] = process.argv.slice(2);
if (!['secret', 'seed', 'integrity', 'measure', 'report', 'cleanup'].includes(operation) || process.argv.length !== 3)
	throw new Error('Usage: production-capacity.mjs secret|seed|integrity|measure|report|cleanup');
const evidence = join(root, '.verification');
mkdirSync(evidence, { recursive: true });
const secretPath = join(homedir(), '.config/cita-suite/production/capacity-secret');

if (operation === 'secret') {
	// Once per measurement: a new random secret, kept only in the private configuration.
	if (existsSync(secretPath)) throw new Error('A measurement secret already exists; remove it after the cleanup of its measurement.');
	mkdirSync(join(homedir(), '.config/cita-suite/production'), { recursive: true, mode: 0o700 });
	writeFileSync(secretPath, randomBytes(32).toString('base64url'), { mode: 0o600 });
	console.log(JSON.stringify({ created: secretPath }));
	process.exit(0);
}
const measurementSecret = operation === 'measure' ? process.env.CITA_PRODUCTION_CAPACITY_SECRET ?? '' : readFileSync(secretPath, 'utf8').trim();
if (measurementSecret.length < 32) throw new Error('The measurement secret is missing. Nothing was done.');
const password = capacityOwnersPassword(measurementSecret, 'production');

if (operation === 'measure') {
	const kitRequire = createRequire(createRequire(join(root, 'apps/web/package.json')).resolve('@sveltejs/kit/package.json'));
	const devalue = await import(pathToFileURL(kitRequire.resolve('devalue')).href);
	const result = { origin: PRODUCTION_APP_ORIGIN, practices: PRACTICES, startedAt: new Date().toISOString(), repetitions: [] };
	const save = () => writeFileSync(join(evidence, 'production-capacity-measure.json'), JSON.stringify(result, null, 2) + '\n');
	const causes = (summary) => Object.fromEntries(Object.entries(summary.byOperation).filter(([, group]) => group.errors > 0)
		.map(([name, group]) => [name, group.errorReasons]));
	const jars = [];
	for (let practice = 1; practice <= PRACTICES; practice++) jars.push(await login(PRODUCTION_APP_ORIGIN, practiceData(practice).email, password));
	for (let repetition = 1; repetition <= 3; repetition++) {
		const measureFrom = Date.now() + 2 * 60_000;
		const until = measureFrom + 10 * 60_000;
		const samples = [];
		await Promise.all(jars.map((jar, index) => runVirtualUser({ origin: PRODUCTION_APP_ORIGIN, jar, data: practiceData(index + 1),
			random: createRandom(`production-${repetition}-${index + 1}`), measureFrom, until, record: (sample) => samples.push(sample) })));
		const summary = summarize(samples);
		result.repetitions.push({ repetition, summary, acceptance: evaluateAcceptance(summary) });
		save();
		console.log(`production-capacity ${repetition} ` + JSON.stringify({ read: summary.read, write: summary.write,
			acceptance: result.repetitions.at(-1).acceptance, errors: causes(summary) }));
	}
	const publicSamples = [];
	const publicFrom = Date.now() + 2 * 60_000;
	const generated = await runPublicGenerator({ origin: PRODUCTION_APP_ORIGIN, practices: PRACTICES, random: createRandom('production-public'),
		measureFrom: publicFrom, until: publicFrom + 10 * 60_000, record: (sample) => publicSamples.push(sample), unflatten: devalue.unflatten, parse: devalue.parse,
		phone: '+5491177100000' });
	const publicSummary = summarize(publicSamples);
	result.publicBooking = { summary: publicSummary, acceptance: evaluateAcceptance(publicSummary), bookingFailures: generated.failures };
	save();
	console.log('production-capacity-public ' + JSON.stringify({ read: publicSummary.read, write: publicSummary.write,
		acceptance: result.publicBooking.acceptance, bookingFailures: generated.failures, errors: causes(publicSummary) }));
	const abuse = await runPublicAbuse({ origin: PRODUCTION_APP_ORIGIN, unflatten: devalue.unflatten, parse: devalue.parse, phone: generated.phone });
	result.publicBooking.abuse = abuse;
	// Integrity and the database's own counters are checked from outside CI (`integrity`).
	result.passedHttp = result.repetitions.every((item) => item.acceptance.passed) && result.publicBooking.acceptance.passed &&
		generated.failures.length === 0 && abuse.passed;
	save();
	console.log('production-capacity-abuse ' + JSON.stringify(abuse));
	console.log('production-capacity-http ' + JSON.stringify({ passed: result.passedHttp }));
	if (!result.passedHttp) process.exitCode = 1;
	process.exit();
}

// Everything else runs on this machine, against production, with the private configuration.
const { env, database } = productionEnvironment(root);
const api = PRODUCTION_API_ORIGIN;
const serviceKey = env.ODONTO_SUPABASE_SERVICE_ROLE_KEY ?? '';
if (env.ODONTO_SUPABASE_URL?.replace(/\/$/, '') !== api || !/^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(serviceKey)) throw new Error('The production API key is not the expected one. Nothing was done.');
const sql = (text, { readOnly = false, variables = {} } = {}) => {
	const result = spawnSync('psql', ['-X', '-h', database.hostname, '-p', database.port, '-U', decodeURIComponent(database.username), '-d', 'postgres',
		'-v', 'ON_ERROR_STOP=1', '-Atq', ...Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`]), '-f', '-'], {
		input: readOnly ? `begin transaction read only;\n${text}\ncommit;\n` : text, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 64 * 1024 ** 2,
		env: { ...process.env, PGPASSWORD: decodeURIComponent(database.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10',
			PGAPPNAME: 'cita_suite_production_capacity' }
	});
	if (result.error || result.status !== 0) throw new Error(`Production capacity ${operation} failed.\n` + psqlDiagnostics(result.stderr).replaceAll(decodeURIComponent(database.password), '[secret]'));
	return result.stdout.split('\n').filter((line) => line && line !== 'BEGIN' && line !== 'COMMIT').join('\n').trim();
};
const admin = (path, init = {}) => fetch(api + '/auth/v1/admin' + path, { ...init, signal: AbortSignal.timeout(15_000),
	headers: { apikey: serviceKey, authorization: 'Bearer ' + serviceKey, 'content-type': 'application/json', ...init.headers } });
const owners = Array.from({ length: PRACTICES }, (_, index) => uuidFrom('capacity-owner-' + (index + 1)));
const DATABASE_STATE = `select jsonb_build_object('databaseBytes',pg_database_size(current_database()),
 'deadlocks',(select deadlocks from pg_stat_database where datname=current_database()))::text;`;

if (operation === 'seed') {
	// Supabase Free turns a project read-only past 500 MB: two practices add about 95 MB.
	const before = JSON.parse(sql(`select jsonb_build_object('databaseBytes',pg_database_size(current_database()),
 'practices',(select count(*) from public.businesses where slug like 'capacity-%'))::text;`, { readOnly: true }));
	if (before.practices) throw new Error('Production already holds capacity practices. Nothing was done.');
	if (!Number.isSafeInteger(before.databaseBytes) || before.databaseBytes + PRACTICES * 50_000_000 > 300_000_000)
		throw new Error(`Production holds ${before.databaseBytes} bytes; the scenario would leave too little margin. Nothing was done.`);
	for (const [index, id] of owners.entries()) {
		const response = await admin('/users', { method: 'POST', body: JSON.stringify({ id, email: practiceData(index + 1).email, password, email_confirm: true }) });
		const user = await response.json().catch(() => null);
		if (!response.ok || user?.id !== id) throw new Error(`Could not create capacity owner ${index + 1} (HTTP ${response.status}).`);
	}
	const started = performance.now();
	const output = sql(readFileSync(join(root, 'scripts/capacity/seed-practices.sql'), 'utf8'), { variables: { practices: String(PRACTICES), owners: JSON.stringify(owners) } });
	const marked = output.split('\n').find((line) => line.startsWith('capacity-seed '));
	if (!marked) throw new Error('The production capacity seed printed no result.');
	const seed = { ...JSON.parse(marked.slice('capacity-seed '.length)), before, durationMs: Math.round(performance.now() - started) };
	writeFileSync(join(evidence, 'production-capacity-seed.json'), JSON.stringify(seed, null, 2) + '\n');
	console.log('production-capacity-seed ' + JSON.stringify(seed));
} else if (operation === 'integrity') {
	// Read only, before and after the load.
	const integrity = { at: new Date().toISOString(), ...JSON.parse(sql(INTEGRITY_SQL + ';', { readOnly: true })), database: JSON.parse(sql(DATABASE_STATE, { readOnly: true })) };
	console.log('production-capacity-integrity ' + JSON.stringify(integrity));
	if (integrity.crossPractice || integrity.overlaps) process.exitCode = 1;
} else if (operation === 'report') {
	// Read only. The counters run since the project's last reset: two reports bracket a measurement.
	const report = JSON.parse(sql(`select jsonb_build_object('at', clock_timestamp(),
 'statements',(select coalesce(jsonb_agg(s),'[]'::jsonb) from (select queryid::text as queryid, left(regexp_replace(query,'\\s+',' ','g'),300) as query,userid::text as userid,toplevel,calls,
   round(total_exec_time::numeric,1) as total_ms,round(max_exec_time::numeric,1) as max_ms,rows,shared_blks_hit,shared_blks_read,temp_blks_written
   from extensions.pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) and calls>=5
   order by total_exec_time desc limit 60) s),
 'database',(select to_jsonb(d) from (select xact_commit,xact_rollback,deadlocks,blks_hit,blks_read,temp_files,temp_bytes,stats_reset
   from pg_stat_database where datname=current_database()) d),
 'databaseBytes',pg_database_size(current_database()))::text;`, { readOnly: true }));
	const path = join(evidence, `production-capacity-report-${report.at.replace(/[:.]/g, '-')}.json`);
	writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
	console.log(JSON.stringify({ report: path, statements: report.statements.length, database: report.database }));
} else {
	const marked = sql(readFileSync(join(root, 'scripts/capacity/cleanup-practices.sql'), 'utf8')).split('\n').find((line) => line.startsWith('capacity-cleanup '));
	if (!marked) throw new Error('The production capacity cleanup printed no result.');
	const removed = JSON.parse(marked.slice('capacity-cleanup '.length));
	const ownersRemoved = await removeCapacityOwners({ practices: PRACTICES, request: admin });
	const remaining = JSON.parse(sql(`select jsonb_build_object('practices',(select count(*) from public.businesses where slug like 'capacity-%'),
		'owners',(select count(*) from auth.users where email like 'capacity-owner-%@example.test'),'databaseBytes',pg_database_size(current_database()))::text;`, { readOnly: true }));
	console.log('production-capacity-cleanup ' + JSON.stringify({ ...removed, ownersRemoved, remaining }));
	if (remaining.practices || remaining.owners) throw new Error('The production capacity cleanup left rows of the scenario: ' + JSON.stringify(remaining));
}

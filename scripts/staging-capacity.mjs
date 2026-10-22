import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STAGING_PROJECT_REF, psqlDiagnostics, stagingConnection, stagingPsql } from './lib/staging-database.mjs';
import { STAGING_APP_ORIGIN } from './lib/staging-deploy.mjs';
import {
	INTEGRITY_SQL, capacityOwnersPassword, createRandom, evaluateAcceptance, login, practiceData, removeCapacityOwners, runPublicAbuse, runPublicGenerator,
	runVirtualUser, summarize, uuidFrom
} from './lib/capacity-load.mjs';

// The capacity scenario on the deployed staging, from an external runner: the Worker
// `cita-suite-staging` and its own Supabase project. Two practices by default, the
// launch of the 20 October decision; five repeats the earlier rehearsal. The same
// generator, virtual users and public generator as the CI scenarios; the hosted
// database of the free plan holds up to five practices (about 240 MB), not 25.
// Every row belongs to a `capacity-` practice and `cleanup` removes them all.
const root = fileURLToPath(new URL('../', import.meta.url));
const [operation] = process.argv.slice(2);
if (!['seed', 'measure', 'report', 'cleanup'].includes(operation) || process.argv.length !== 3)
	throw new Error('Usage: staging-capacity.mjs seed|measure|report|cleanup');
const PRACTICES = Number(process.env.CITA_STAGING_CAPACITY_PRACTICES || 2);
const MAX_PRACTICES = 5;
if (PRACTICES !== 2 && PRACTICES !== MAX_PRACTICES) throw new Error('The staging capacity scenario has 2 or 5 practices. Nothing was done.');
const url = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const serviceKey = process.env.CITA_STAGING_SERVICE_ROLE_KEY ?? '';
if (!/^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(serviceKey)) throw new Error('The staging service key is required. Nothing was done.');
// The owners' password is derived from the staging key: seeding and measuring run in
// separate workflow runs, and no password is stored anywhere.
const password = capacityOwnersPassword(serviceKey, 'staging');
const api = `https://${STAGING_PROJECT_REF}.supabase.co`;
const options = '-c application_name=cita_suite_staging_capacity';
const sql = (text, variables = {}) => {
	const result = stagingPsql(url, ['-Atq', ...Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`]), '-f', '-'],
		{ input: text, options, timeout: 1_800_000 });
	if (result.error || result.status !== 0) throw new Error(`Staging capacity ${operation} failed.\n` + psqlDiagnostics(result.stderr));
	return result.stdout.trim();
};
const admin = (path, init = {}) => fetch(api + '/auth/v1/admin' + path, { ...init, signal: AbortSignal.timeout(15_000),
	headers: { apikey: serviceKey, authorization: 'Bearer ' + serviceKey, 'content-type': 'application/json', ...init.headers } });
const owners = Array.from({ length: PRACTICES }, (_, index) => uuidFrom('capacity-owner-' + (index + 1)));
const DATABASE_STATE = `select jsonb_build_object('databaseBytes',pg_database_size(current_database()),
 'deadlocks',(select deadlocks from pg_stat_database where datname=current_database()))::text;`;
const evidence = join(root, '.verification');
mkdirSync(evidence, { recursive: true });

if (operation === 'seed') {
	// Supabase Free turns a project read-only past 500 MB. Five practices added 238 MB to
	// a fresh database in CI: seed only with a wide margin left below the limit.
	// The Realtime partitions too: a broadcast from a trigger that finds no partition for its day is
	// lost with a warning, as the first hosted seed showed.
	const before = JSON.parse(sql(`select jsonb_build_object('databaseBytes',pg_database_size(current_database()),
 'realtimePartitions',(select coalesce(jsonb_agg(c.relname order by c.relname),'[]') from pg_inherits i join pg_class c on c.oid=i.inhrelid
  where i.inhparent=to_regclass('realtime.messages')))::text;`));
	if (!Number.isSafeInteger(before.databaseBytes) || before.databaseBytes + PRACTICES * 50_000_000 > 450_000_000)
		throw new Error(`The staging database holds ${before.databaseBytes} bytes; the scenario would leave too little margin below 500 MB. Nothing was done.`);
	console.log('staging-capacity-before ' + JSON.stringify(before));
	for (const [index, id] of owners.entries()) {
		const response = await admin('/users', { method: 'POST',
			body: JSON.stringify({ id, email: practiceData(index + 1).email, password, email_confirm: true }) });
		const user = await response.json().catch(() => null);
		if (!response.ok || user?.id !== id) throw new Error(`Could not create staging capacity owner ${index + 1} (HTTP ${response.status}).`);
	}
	const started = performance.now();
	const output = sql(readFileSync(join(root, 'scripts/capacity/seed-practices.sql'), 'utf8'), { practices: String(PRACTICES), owners: JSON.stringify(owners) });
	const marked = output.split('\n').find(line => line.startsWith('capacity-seed '));
	if (!marked) throw new Error('The staging capacity seed printed no result.');
	const seed = { ...JSON.parse(marked.slice('capacity-seed '.length)), durationMs: Math.round(performance.now() - started) };
	writeFileSync(join(evidence, 'staging-capacity-seed.json'), JSON.stringify(seed, null, 2) + '\n');
	console.log('staging-capacity-seed ' + JSON.stringify(seed));
} else if (operation === 'measure') {
	const kitRequire = createRequire(createRequire(join(root, 'apps/web/package.json')).resolve('@sveltejs/kit/package.json'));
	const devalue = await import(pathToFileURL(kitRequire.resolve('devalue')).href);
	const databaseBefore = JSON.parse(sql(DATABASE_STATE));
	// Also before the load: a baseline, and a failure in seconds rather than after the whole measurement.
	const integrityBefore = JSON.parse(sql(INTEGRITY_SQL + ';'));
	if (integrityBefore.crossPractice || integrityBefore.overlaps) throw new Error('The seeded scenario already breaks isolation or double booking: ' + JSON.stringify(integrityBefore));
	// Evidence after every phase: a run cut short by its deadline still keeps what it measured.
	const result = { origin: STAGING_APP_ORIGIN, practices: PRACTICES, startedAt: new Date().toISOString(), integrityBefore, repetitions: [] };
	const save = () => writeFileSync(join(evidence, 'staging-capacity-measure.json'), JSON.stringify(result, null, 2) + '\n');
	// The causes of each operation's errors, for the log: counts only, no data.
	const causes = summary => Object.fromEntries(Object.entries(summary.byOperation).filter(([, group]) => group.errors > 0)
		.map(([name, group]) => [name, group.errorReasons]));
	const jars = [];
	for (let practice = 1; practice <= PRACTICES; practice++) jars.push(await login(STAGING_APP_ORIGIN, practiceData(practice).email, password));
	for (let repetition = 1; repetition <= 3; repetition++) {
		const measureFrom = Date.now() + 2 * 60_000;
		const until = measureFrom + 10 * 60_000;
		const samples = [];
		await Promise.all(jars.map((jar, index) => runVirtualUser({ origin: STAGING_APP_ORIGIN, jar, data: practiceData(index + 1),
			random: createRandom(`staging-${repetition}-${index + 1}`), measureFrom, until, record: sample => samples.push(sample) })));
		const summary = summarize(samples);
		result.repetitions.push({ repetition, summary, acceptance: evaluateAcceptance(summary) });
		save();
		console.log(`staging-capacity ${repetition} ` + JSON.stringify({ read: summary.read, write: summary.write,
			acceptance: result.repetitions.at(-1).acceptance, errors: causes(summary) }));
	}
	const publicSamples = [];
	const publicFrom = Date.now() + 2 * 60_000;
	const generated = await runPublicGenerator({ origin: STAGING_APP_ORIGIN, practices: PRACTICES, random: createRandom('staging-public'),
		measureFrom: publicFrom, until: publicFrom + 10 * 60_000, record: sample => publicSamples.push(sample), unflatten: devalue.unflatten, parse: devalue.parse,
		phone: '+5491177000000' });
	const publicSummary = summarize(publicSamples);
	result.publicBooking = { summary: publicSummary, acceptance: evaluateAcceptance(publicSummary), bookingFailures: generated.failures };
	save();
	console.log('staging-capacity-public ' + JSON.stringify({ read: publicSummary.read, write: publicSummary.write,
		acceptance: result.publicBooking.acceptance, bookingFailures: generated.failures, errors: causes(publicSummary) }));
	const abuse = await runPublicAbuse({ origin: STAGING_APP_ORIGIN, unflatten: devalue.unflatten, parse: devalue.parse, phone: generated.phone });
	result.publicBooking.abuse = abuse;
	save();
	console.log('staging-capacity-abuse ' + JSON.stringify(abuse));
	const database = JSON.parse(sql(DATABASE_STATE));
	result.integrity = JSON.parse(sql(INTEGRITY_SQL + ';'));
	// The counter is the project's since its last reset: what matters is what this measurement added.
	result.database = { ...database, deadlocksDuringMeasurement: database.deadlocks - databaseBefore.deadlocks };
	// One generator, free slots and a different phone each time: every scheduled booking must succeed.
	result.passed = result.repetitions.every(item => item.acceptance.passed) && result.publicBooking.acceptance.passed &&
		generated.failures.length === 0 && abuse.passed && result.integrity.crossPractice === 0 && result.integrity.overlaps === 0 &&
		result.database.deadlocksDuringMeasurement === 0;
	save();
	console.log('staging-capacity-result ' + JSON.stringify({ passed: result.passed, integrity: result.integrity, database: result.database }));
	if (!result.passed) process.exitCode = 1;
} else if (operation === 'report') {
	// Read only: what the hosted database spent its time on. Statements run at least 20
	// times, so one-off work such as the seed does not hide the load; normalized texts
	// carry parameters, not values. Cache hits against disk reads tell whether the data
	// the load touches fits in the instance's memory.
	const report = JSON.parse(sql(`select jsonb_build_object(
 'statements',(select coalesce(jsonb_agg(s),'[]'::jsonb) from (select left(regexp_replace(query,'\\s+',' ','g'),300) as query,calls,
   round(total_exec_time::numeric,1) as total_ms,round(mean_exec_time::numeric,2) as mean_ms,round(max_exec_time::numeric,1) as max_ms,rows,
   shared_blks_hit,shared_blks_read,temp_blks_written
   from extensions.pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) and calls>=20
   order by total_exec_time desc limit 25) s),
 'database',(select to_jsonb(d) from (select xact_commit,xact_rollback,deadlocks,blks_hit,blks_read,temp_files,temp_bytes,stats_reset
   from pg_stat_database where datname=current_database()) d),
 'settings',(select jsonb_object_agg(name,setting||coalesce(unit,'')) from pg_settings
   where name in ('shared_buffers','effective_cache_size','work_mem','maintenance_work_mem','max_connections','statement_timeout','server_version')),
 'databaseBytes',pg_database_size(current_database()))::text;`));
	writeFileSync(join(evidence, 'staging-capacity-report.json'), JSON.stringify(report, null, 2) + '\n');
	console.log('staging-capacity-report ' + JSON.stringify(report));
} else {
	// The cleanup the CI scenarios rehearse on the same data before it runs here.
	const marked = sql(readFileSync(join(root, 'scripts/capacity/cleanup-practices.sql'), 'utf8')).split('\n').find(line => line.startsWith('capacity-cleanup '));
	if (!marked) throw new Error('The staging capacity cleanup printed no result.');
	const removed = JSON.parse(marked.slice('capacity-cleanup '.length));
	// Every owner a scenario of either size may have created, whichever was seeded.
	const ownersRemoved = await removeCapacityOwners({ practices: MAX_PRACTICES, request: admin });
	const remaining = JSON.parse(sql(`select jsonb_build_object('practices',(select count(*) from public.businesses where slug like 'capacity-%'),
		'owners',(select count(*) from auth.users where email like 'capacity-owner-%@example.test'),'databaseBytes',pg_database_size(current_database()))::text;`));
	if (remaining.practices || remaining.owners) throw new Error('The staging capacity cleanup left rows of the scenario: ' + JSON.stringify(remaining));
	// Staging only, never production: the space of the removed rows goes back to the
	// project, so repeated rehearsals do not bring the free plan near its 500 MB. The
	// tables are nearly empty again and each rewrite takes seconds.
	sql(`vacuum (full, analyze) public.appointments,public.appointment_professionals,public.patients,public.professional_patient_links,
 public.business_data_revisions,public.clinical_entries,public.appointment_booking_contexts,public.appointment_patient_information_contexts;`);
	remaining.databaseBytesAfterVacuum = Number(sql('select pg_database_size(current_database());'));
	console.log('staging-capacity-cleanup ' + JSON.stringify({ ...removed, ownersRemoved, remaining }));
}

import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STAGING_PROJECT_REF, psqlDiagnostics, stagingConnection, stagingPsql } from './lib/staging-database.mjs';
import { STAGING_APP_ORIGIN } from './lib/staging-deploy.mjs';
import {
	createRandom, evaluateAcceptance, login, practiceData, runPublicAbuse, runPublicGenerator, runVirtualUser, summarize, uuidFrom
} from './lib/capacity-load.mjs';

// The five-practice capacity scenario on the deployed staging, from an external
// runner: the Worker `cita-suite-staging` and its own Supabase project. The same
// generator, virtual users and public generator as the CI scenarios; the hosted
// database of the free plan holds this scenario (about 240 MB), not the 25-practice
// one. Every row belongs to a `capacity-` practice and `cleanup` removes them all.
const root = fileURLToPath(new URL('../', import.meta.url));
const [operation] = process.argv.slice(2);
if (!['seed', 'measure', 'cleanup'].includes(operation) || process.argv.length !== 3)
	throw new Error('Usage: staging-capacity.mjs seed|measure|cleanup');
const PRACTICES = 5;
const url = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const serviceKey = process.env.CITA_STAGING_SERVICE_ROLE_KEY ?? '';
if (!/^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(serviceKey)) throw new Error('The staging service key is required. Nothing was done.');
// The owners' password is derived from the staging key: seeding and measuring run in
// separate workflow runs, and no password is stored anywhere.
const password = createHmac('sha256', serviceKey).update('cita-suite-staging-capacity-owners').digest('base64url');
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
const evidence = join(root, '.verification');
mkdirSync(evidence, { recursive: true });

if (operation === 'seed') {
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
	const jars = [];
	for (let practice = 1; practice <= PRACTICES; practice++) jars.push(await login(STAGING_APP_ORIGIN, practiceData(practice).email, password));
	const repetitions = [];
	for (let repetition = 1; repetition <= 3; repetition++) {
		const measureFrom = Date.now() + 2 * 60_000;
		const until = measureFrom + 10 * 60_000;
		const samples = [];
		await Promise.all(jars.map((jar, index) => runVirtualUser({ origin: STAGING_APP_ORIGIN, jar, data: practiceData(index + 1),
			random: createRandom(`staging-${repetition}-${index + 1}`), measureFrom, until, record: sample => samples.push(sample) })));
		const summary = summarize(samples);
		repetitions.push({ repetition, summary, acceptance: evaluateAcceptance(summary) });
		console.log(`staging-capacity ${repetition} ` + JSON.stringify({ read: summary.read, write: summary.write, acceptance: repetitions.at(-1).acceptance }));
	}
	const publicSamples = [];
	const publicFrom = Date.now() + 2 * 60_000;
	const phone = await runPublicGenerator({ origin: STAGING_APP_ORIGIN, practices: PRACTICES, random: createRandom('staging-public'),
		measureFrom: publicFrom, until: publicFrom + 10 * 60_000, record: sample => publicSamples.push(sample), unflatten: devalue.unflatten, phone: '+5491177000000' });
	const publicSummary = summarize(publicSamples);
	const abuse = await runPublicAbuse({ origin: STAGING_APP_ORIGIN, unflatten: devalue.unflatten, parse: devalue.parse, phone });
	const result = { origin: STAGING_APP_ORIGIN, practices: PRACTICES, repetitions,
		publicBooking: { summary: publicSummary, acceptance: evaluateAcceptance(publicSummary), abuse },
		database: JSON.parse(sql(`select jsonb_build_object('databaseBytes',pg_database_size(current_database()),
			'deadlocks',(select deadlocks from pg_stat_database where datname=current_database()))::text;`)) };
	result.passed = repetitions.every(item => item.acceptance.passed) && result.publicBooking.acceptance.passed && abuse.passed;
	writeFileSync(join(evidence, 'staging-capacity-measure.json'), JSON.stringify(result, null, 2) + '\n');
	console.log('staging-capacity-result ' + JSON.stringify({ passed: result.passed, abuse, database: result.database,
		public: { read: publicSummary.read, write: publicSummary.write } }));
	if (!result.passed) process.exitCode = 1;
} else {
	// Integrations restrict deleting their practice; everything else follows by cascade.
	sql(`begin;
delete from public.booking_integrations i using public.businesses b where b.id=i.business_id and b.slug like 'capacity-%';
delete from public.businesses where slug like 'capacity-%';
commit;`);
	for (const id of owners) {
		const response = await admin('/users/' + id, { method: 'DELETE' });
		if (!response.ok && response.status !== 404) throw new Error(`Could not remove staging capacity owner ${id} (HTTP ${response.status}).`);
	}
	const remaining = JSON.parse(sql(`select jsonb_build_object('practices',(select count(*) from public.businesses where slug like 'capacity-%'),
		'owners',(select count(*) from auth.users where email like 'capacity-owner-%@example.test'))::text;`));
	if (remaining.practices || remaining.owners) throw new Error('The staging capacity cleanup left rows of the scenario: ' + JSON.stringify(remaining));
	console.log('staging-capacity-cleanup ' + JSON.stringify({ cleaned: true }));
}

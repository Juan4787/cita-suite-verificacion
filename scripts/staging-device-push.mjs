import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviceCleanupSql, deviceLinkQuery, devicePractice, deviceReportSql, deviceSeedSql } from './lib/device-push.mjs';
import { STAGING_PROJECT_REF, psqlDiagnostics, stagingConnection, stagingPsql } from './lib/staging-database.mjs';
import { STAGING_APP_ORIGIN, stagingSupabaseKey } from './lib/staging-deploy.mjs';

// Real-device Web Push check on staging: one synthetic practice with an appointment
// three hours ahead, so its 24 h reminder is due on the next push run. The person
// opens the management link on the phone and enables notifications; the report reads
// the delivery stages the service worker acknowledged. Only this run's rows are
// touched. Seed, report and cleanup run in the staging workflow; the management link
// is read on the local machine only (`link`), never in a public log.
const root = fileURLToPath(new URL('../', import.meta.url));
const [operation, runArgument] = process.argv.slice(2);
if (!['seed', 'link', 'report', 'cleanup'].includes(operation))
	throw new Error('Usage: staging-device-push.mjs seed|link <run>|report <run>|cleanup <run>');
const run = operation === 'seed' ? randomBytes(6).toString('hex') : runArgument;
if (!/^[a-f0-9]{12}$/.test(run ?? '')) throw new Error('A run identifier of 12 hexadecimal characters is required.');
const slug = devicePractice('staging', run);

if (operation === 'link') {
	const key = stagingSupabaseKey(JSON.parse(readFileSync(join(homedir(), '.config/cita-suite/staging/api-keys.json'), 'utf8')), 'service_role');
	const rest = deviceLinkQuery(`https://${STAGING_PROJECT_REF}.supabase.co`, slug);
	const response = await fetch(rest, { headers: { apikey: key, authorization: `Bearer ${key}` } });
	const rows = response.ok ? await response.json() : null;
	if (!Array.isArray(rows) || rows.length !== 1 || !/^[a-f0-9]{64}$/.test(rows[0]?.confirmation_token ?? ''))
		throw new Error(`The synthetic appointment of run ${run} was not found (HTTP ${response.status}).`);
	console.log(`${STAGING_APP_ORIGIN}/turno/${rows[0].confirmation_token}`);
	process.exit(0);
}
const url = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const options = '-c application_name=cita_suite_staging_device_push';
const execute = (sql, args = ['-q']) => {
	const result = stagingPsql(url, [...args, '-f', '-'], { input: sql, options });
	if (result.error || result.status !== 0) throw new Error(`Staging ${operation} failed.\n` + psqlDiagnostics(result.stderr));
	return result.stdout.trim();
};

if (operation === 'seed') {
	execute(deviceSeedSql(slug, 'Prueba de dispositivo staging'));
	console.log(JSON.stringify({ run, practice: slug }));
}

// Endpoints are capabilities: only their host is reported.
const report = () => JSON.parse(execute(deviceReportSql(run, slug), ['-Atq']));

if (operation === 'cleanup') {
	execute(deviceCleanupSql(slug));
	const remaining = report();
	if (remaining.appointmentStartsAt !== null || remaining.subscriptions.length || remaining.attempts.length)
		throw new Error('The device cleanup left rows of its run.');
	console.log(JSON.stringify({ run, cleaned: true }));
} else if (operation === 'report') {
	const result = report();
	mkdirSync(join(root, '.verification'), { recursive: true });
	writeFileSync(join(root, `.verification/staging-device-${run}.json`), JSON.stringify(result, null, 2) + '\n');
	console.log(JSON.stringify(result, null, 2));
}

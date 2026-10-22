import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviceCleanupSql, deviceLinkQuery, devicePractice, deviceReportSql, deviceSeedSql } from './lib/device-push.mjs';
import { PRODUCTION_API_ORIGIN, productionEnvironment, productionKeys, productionPsql } from './lib/production-database.mjs';
import { PRODUCTION_APP_ORIGIN } from './lib/production-deploy.mjs';

// Real-device Web Push check on production, after the production scheduler is active: the same
// synthetic practice, report and cleanup as staging (lib/device-push.mjs), all from this machine,
// because CI never reaches the production database. The person opens the management link that
// `link` prints here, on the phone, and enables notifications; the reminder is due on the next
// push run. The management link is printed only on this terminal, never kept in a file or a log.
const root = fileURLToPath(new URL('../', import.meta.url));
const [operation, runArgument] = process.argv.slice(2);
if (!['seed', 'link', 'report', 'cleanup'].includes(operation) || process.argv.length > 4)
	throw new Error('Usage: production-device-push.mjs seed|link <run>|report <run>|cleanup <run>');
const run = operation === 'seed' ? randomBytes(6).toString('hex') : runArgument;
const slug = devicePractice('production', run);
const { env, database } = productionEnvironment(root);
const execute = (sql, args = ['-q']) => productionPsql(database, sql, { application: 'cita_suite_production_device_push', args }).trim();

if (operation === 'link') {
	const { serviceKey } = productionKeys(env);
	const response = await fetch(deviceLinkQuery(PRODUCTION_API_ORIGIN, slug), { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } });
	const rows = response.ok ? await response.json() : null;
	if (!Array.isArray(rows) || rows.length !== 1 || !/^[a-f0-9]{64}$/.test(rows[0]?.confirmation_token ?? ''))
		throw new Error(`The synthetic appointment of run ${run} was not found (HTTP ${response.status}).`);
	console.log(`${PRODUCTION_APP_ORIGIN}/turno/${rows[0].confirmation_token}`);
	process.exit(0);
}
if (operation === 'seed') {
	execute(deviceSeedSql(slug, 'Prueba de dispositivo producción'));
	console.log(JSON.stringify({ run, practice: slug }));
	process.exit(0);
}
const report = () => JSON.parse(execute(deviceReportSql(run, slug), ['-Atq']));
if (operation === 'cleanup') {
	execute(deviceCleanupSql(slug));
	const remaining = report();
	if (remaining.appointmentStartsAt !== null || remaining.subscriptions.length || remaining.attempts.length)
		throw new Error('The device cleanup left rows of its run.');
	console.log(JSON.stringify({ run, cleaned: true }));
} else {
	const result = report();
	mkdirSync(join(root, '.verification'), { recursive: true });
	writeFileSync(join(root, `.verification/production-device-${run}.json`), JSON.stringify(result, null, 2) + '\n');
	console.log(JSON.stringify(result, null, 2));
}

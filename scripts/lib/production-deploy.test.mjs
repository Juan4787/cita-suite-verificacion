import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertProductionAppConfig, assertProductionSchedulerConfig, missingSecrets, PRODUCTION_APP_SECRETS } from './production-deploy.mjs';

const json = (path) => JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, ''));

test('the production deployment accepts only the production app and scheduler', () => {
	const app = json('apps/web/wrangler.jsonc');
	assert.equal(assertProductionAppConfig(app), app);
	for (const changed of [
		{ ...app, name: 'cita-suite-staging' },
		{ ...app, account_id: '0'.repeat(32) },
		{ ...app, vars: { ...app.vars, PUBLIC_SITE_URL: 'https://cita-suite-staging.cita-suite.workers.dev' } },
		{ ...app, placement: { region: 'aws:us-west-2' } },
		{ ...app, triggers: { crons: ['*/5 * * * *'] } },
		{ ...app, routes: ['example.com/*'] }
	])
		assert.throws(() => assertProductionAppConfig(changed), /not the production target/);
	assert.throws(() => assertProductionAppConfig(json('apps/web/wrangler.staging.jsonc')), /not the production target/);

	const scheduler = json('apps/scheduler/wrangler.jsonc');
	assert.equal(assertProductionSchedulerConfig(scheduler), scheduler);
	for (const changed of [
		{ ...scheduler, services: [{ binding: 'APP', service: 'cita-suite-staging' }] },
		{ ...scheduler, triggers: { crons: scheduler.triggers.crons.slice(1) } },
		{ ...scheduler, workers_dev: true },
		{ ...scheduler, name: 'cita-suite-scheduler-staging' }
	])
		assert.throws(() => assertProductionSchedulerConfig(changed), /not the production target/);
});

test('a deployment that would run without a required secret is refused', () => {
	assert.deepEqual(missingSecrets([...PRODUCTION_APP_SECRETS, 'MP_ACCESS_TOKEN']), []);
	assert.deepEqual(missingSecrets(PRODUCTION_APP_SECRETS.filter((name) => name !== 'INTERNAL_JOB_SECRET')), ['INTERNAL_JOB_SECRET']);
});

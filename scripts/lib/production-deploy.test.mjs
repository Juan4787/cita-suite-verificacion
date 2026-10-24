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

test('scheduler activation proves the private credential without running a job and fails closed on disagreement', async () => {
 const {assertProductionSchedulerAuthentication:check}=await import('./production-deploy.mjs');
 assert.equal(typeof check,'function');
 const secret='synthetic-private-job-secret-'.repeat(2);
 const calls=[];
 const fetcher=statuses=>async (url,options)=>{
  calls.push({url,options});return {status:statuses.shift(),text(){throw new Error('No response body may be exposed');}};
 };
 await assert.rejects(()=>check({secret,legacyEnabled:true,fetch:fetcher([])}),/legacy/i);
 await assert.rejects(()=>check({secret,legacyEnabled:null,fetch:fetcher([])}),/legacy/i);
 assert.equal(calls.length,0);
 await assert.rejects(()=>check({secret:'short',legacyEnabled:false,fetch:fetcher([])}),/secret/i);assert.equal(calls.length,0);
 await assert.rejects(()=>check({secret,legacyEnabled:false,fetch:fetcher([401,401])}),/authentication/i);assert.equal(calls.length,2);
 for(const call of calls){assert.equal(call.url,'https://app.cita-suite.workers.dev/internal/jobs/send-push-reminders');assert.equal(call.options.method,'POST');assert.equal(call.options.redirect,'manual');assert.ok(call.options.signal instanceof AbortSignal);}
 assert.notEqual(calls[0].options.headers.authorization,calls[1].options.headers.authorization);assert.equal(calls[1].options.headers.authorization,`Bearer ${secret}`);
 calls.length=0;
 await assert.rejects(()=>check({secret,legacyEnabled:false,fetch:fetcher([410])}),/authentication/i);assert.equal(calls.length,1);
 for(const status of [200,302,403,500,503]){
  calls.length=0;await assert.rejects(()=>check({secret,legacyEnabled:false,fetch:fetcher([401,status])}),/authentication/i);assert.equal(calls.length,2);
 }
 calls.length=0;
 const receipt=await check({secret,legacyEnabled:false,fetch:fetcher([401,410])});
 assert.deepEqual(receipt,{legacyEntrypointsDisabled:true,unauthorizedStatus:401,authorizedStatus:410});assert.doesNotMatch(JSON.stringify(receipt),/synthetic-private/);
 await assert.rejects(()=>check({secret,legacyEnabled:false,fetch:async()=>{throw new Error(secret)}}),e=>!e.message.includes(secret)&&/authentication/i.test(e.message));
});

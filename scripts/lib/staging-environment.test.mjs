import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStagingEnvironment } from './staging-environment.mjs';

function fixture(run) {
	const root = mkdtempSync(join(tmpdir(), 'cita-staging-guard-'));
	const descriptor = {
		environment: 'isolated-synthetic-staging', appOrigin: 'https://app-staging.example.test',
		nataliaOrigin: 'https://natalia-staging.example.test', supabaseProjectRef: 'abcdefghij1234567890',
		supabaseOrigin: 'https://abcdefghij1234567890.supabase.co', revision: 'a'.repeat(40),
		bookingIntegrationKey: 'b'.repeat(32), syntheticBusinessId: '90000000-0000-4000-8000-000000000001',
		testEmail: 'owner@example.test', masterEmail: 'master@example.test'
	};
	const path = join(root, 'staging.json');
	const env = { CITA_STAGING_DESCRIPTOR: path,
		CITA_STAGING_ANON_KEY: 'synthetic', CITA_STAGING_SERVICE_ROLE_KEY: 'synthetic',
		CITA_STAGING_TEST_PASSWORD: 'synthetic', CITA_STAGING_MASTER_PASSWORD: 'synthetic',
		CITA_STAGING_DATABASE_URL: 'postgresql://postgres:synthetic@db.abcdefghij1234567890.supabase.co/postgres'
	};
	const check = () => { writeFileSync(path, JSON.stringify(descriptor)); return loadStagingEnvironment(root, env); };
	try { run({ root, descriptor, env, check }); } finally { rmSync(root, { recursive: true }); }
}

test('release preflight requires an explicit separate target and synthetic identities', () => fixture(({ descriptor, env, check }) => {
	assert.equal(check().app.origin, descriptor.appOrigin);
	delete env.CITA_STAGING_DESCRIPTOR;
	assert.throws(check, /No remote requests/);
}));
test('known and currently configured production projects are refused before release work', () => fixture(({ root, descriptor, check }) => {
	descriptor.appOrigin = 'https://app.cita-suite.workers.dev';
	assert.throws(check, /Production targets/);
	descriptor.appOrigin = 'https://app-staging.example.test';
	writeFileSync(join(root, '.env'), 'ODONTO_SUPABASE_URL=https://abcdefghij1234567890.supabase.co\n');
	assert.throws(check, /Production targets/);
}));
test('an invalid SQL credential cannot leak its contents through validation errors', () => fixture(({ env, check }) => {
	env.CITA_STAGING_DATABASE_URL = 'invalid-secret-password';
	assert.throws(check, error => error.message === 'Invalid staging SQL connection.' && !error.stack.includes(env.CITA_STAGING_DATABASE_URL));
}));
test('release refuses real email addresses and a missing booking contract', () => fixture(({ descriptor, check }) => {
	descriptor.testEmail = 'real@example.com';
	assert.throws(check, /synthetic/);
	descriptor.testEmail = 'owner@example.test';
	delete descriptor.bookingIntegrationKey;
	assert.throws(check, /booking integration/);
}));

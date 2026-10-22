import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertE2EEnvironment, inspectOwnedFixture } from './e2e-environment.mjs';

test('production credentials cannot implicitly select an E2E environment', () => {
	assert.throws(() => assertE2EEnvironment({ ODONTO_SUPABASE_URL: 'https://production.example.test' }, 'http://127.0.0.1:5173'), /verified isolated/);
	assert.throws(() => assertE2EEnvironment({}, 'http://127.0.0.1:5173'), /fallbacks are forbidden/);
	// Hosted environments are checked by the release verification itself, never by the browser suite.
	assert.throws(() => assertE2EEnvironment({ CITA_E2E_ENVIRONMENT: 'isolated-staging', ODONTO_SUPABASE_URL: 'https://staging.supabase.co' },
		'https://staging.example.test'), /verified isolated/);
});
test('demo E2E refuses remote origins and non-demo servers', () => {
	assert.throws(() => assertE2EEnvironment({ CITA_E2E_ENVIRONMENT: 'demo', DEMO_MODE: 'true' }, 'https://app.example.test'), /local demo/);
	assert.throws(() => assertE2EEnvironment({ CITA_E2E_ENVIRONMENT: 'demo', DEMO_MODE: 'false' }, 'http://127.0.0.1:5173'), /local demo/);
	assert.doesNotThrow(() => assertE2EEnvironment({ CITA_E2E_ENVIRONMENT: 'demo', DEMO_MODE: 'true' }, 'http://127.0.0.1:5173'));
});
test('local Supabase opt-in refuses a remote SQL connection', () => {
	assert.throws(() => assertE2EEnvironment({ CITA_E2E_ENVIRONMENT: 'supabase-local', E2E_ALLOW_DESTRUCTIVE: 'true',
		ODONTO_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_DB_URL: 'postgresql://test:test@db.example.test/postgres' }, 'http://127.0.0.1:5173'), /explicit loopback/);
});
test('an unowned receipt cannot trigger Docker inspection or authorize remote fixture use', () => {
	assert.throws(() => inspectOwnedFixture({ container: 'another-project', runId: 'x', appOrigin: 'https://prod.example.test', apiOrigin: 'https://prod.example.test' }), /owned loopback/);
});

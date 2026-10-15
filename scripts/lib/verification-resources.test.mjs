import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLightVerificationResources, assertHostedIntegrationResources } from './verification-resources.mjs';

const GiB = 1024 ** 3;
const ample = { totalMemoryBytes: 16 * GiB, availableMemoryBytes: 12 * GiB, cpus: 4 };
const hosted = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };
test('integration cannot consume the local computer even when it currently has free RAM', () => {
	assert.throws(() => assertHostedIntegrationResources({}, ample), /Local execution was disabled/);
	assert.throws(() => assertHostedIntegrationResources({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }, ample));
	assert.doesNotThrow(() => assertHostedIntegrationResources(hosted, ample));
});
test('resource preflight rejects a constrained hosted runner and a saturated local host', () => {
	assert.throws(() => assertHostedIntegrationResources(hosted, { ...ample, availableMemoryBytes: GiB }), /Insufficient hosted/);
	assert.throws(() => assertHostedIntegrationResources(hosted, { ...ample, cpus: 2 }), /Insufficient hosted/);
	assert.throws(() => assertLightVerificationResources({ ...ample, availableMemoryBytes: GiB }), /No new test/);
	assert.doesNotThrow(() => assertLightVerificationResources(ample));
});

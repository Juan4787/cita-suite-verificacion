import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullVerificationImage, transientImageFailure } from './verification-images.mjs';

test('rate limiting retries sequentially without changing the image, then records its digest', async () => {
	const calls = [], delays = [], attempts = [];
	const digest = 'sha256:' + 'a'.repeat(64);
	await pullVerificationImage('registry/service:fixed', {
		pull: image => { calls.push(image); return calls.length === 1
			? { status: 1, stderr: 'toomanyrequests: Rate exceeded' }
			: { status: 0, stdout: `Digest: ${digest}` }; },
		sleep: async ms => delays.push(ms), onAttempt: attempt => attempts.push(attempt)
	});
	assert.deepEqual(calls, ['registry/service:fixed', 'registry/service:fixed']);
	assert.deepEqual(delays, [15_000]);
	assert.equal(attempts[0].retry, true);
	assert.equal(attempts[1].digest, digest);
});

test('persistent throttling exhausts its bound and a missing tag fails immediately', async () => {
	let calls = 0;
	await assert.rejects(pullVerificationImage('fixed', {
		pull: () => { calls++; return { status: 1, stderr: 'toomanyrequests: Rate exceeded' }; },
		sleep: async () => {}
	}), /preparation failed/);
	assert.equal(calls, 5);
	calls = 0;
	await assert.rejects(pullVerificationImage('missing', {
		pull: () => { calls++; return { status: 1, stderr: 'manifest unknown' }; },
		sleep: async () => assert.fail('permanent failures must not retry')
	}), /manifest unknown/);
	assert.equal(calls, 1);
	assert.equal(transientImageFailure('denied: requested access to the resource is denied'), false);
});

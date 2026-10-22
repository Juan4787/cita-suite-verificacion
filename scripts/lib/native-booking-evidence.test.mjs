import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeBookingEvidencePath } from './native-booking-evidence.mjs';

test('development, candidate and rollback profiles preserve separate native booking evidence', () => {
	const root = '/owned/project';
	const paths = ['integration', 'integration-artifact', 'integration-rollback'].map(profile =>
		nativeBookingEvidencePath(root, { directory: `${root}/.verification/runs/owned-run/${profile}/native-booking` }));
	assert.equal(new Set(paths).size, 3, 'later profiles must not overwrite earlier results or screenshots');
	assert.equal(nativeBookingEvidencePath(root, { staging: true }), `${root}/.verification/native-booking-staging`);
});

test('a custom evidence directory cannot escape verification or use the shared root', () => {
	for (const directory of ['/outside/project', '/owned/project/.verification', '/owned/project/.verification/../../outside', '/owned/project/.verification-other/results'])
		assert.throws(() => nativeBookingEvidencePath('/owned/project', { directory }), /owned verification/);
});

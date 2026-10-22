import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertIntegrationArtifact, loadRollbackArtifact } from './integration-artifact.mjs';

const current = 'a'.repeat(40), baseline = 'b'.repeat(40), unrelated = 'c'.repeat(40);
const artifact = revision => ({ revision, files: new Map([['.verification/cloudflare-bundle-production/_worker.js', Buffer.from('worker')]]) });

test('a baseline cannot stand in for the candidate, even with an explicit baseline revision', () => {
	assert.equal(assertIntegrationArtifact(artifact(current), current, 'candidate').revision, current);
	assert.throws(() => assertIntegrationArtifact(artifact(baseline), current, 'candidate'), /candidate/);
	assert.throws(() => assertIntegrationArtifact(artifact(baseline), current, 'candidate', baseline), /candidate/);
	assert.throws(() => assertIntegrationArtifact(artifact(current), current, 'candidate', baseline), /candidate/);
});

test('rollback compatibility requires the exact distinct baseline and its production bundle', () => {
	assert.equal(assertIntegrationArtifact(artifact(baseline), current, 'rollback', baseline).revision, baseline);
	for (const expected of [undefined, '', 'invalid', current, unrelated])
		assert.throws(() => assertIntegrationArtifact(artifact(baseline), current, 'rollback', expected), /baseline/);
	assert.throws(() => assertIntegrationArtifact(artifact(current), current, 'rollback', baseline), /baseline/);
	assert.throws(() => assertIntegrationArtifact({ revision: baseline, files: new Map() }, current, 'rollback', baseline), /bundle/);
	assert.throws(() => assertIntegrationArtifact(artifact(baseline), current, 'other', baseline), /purpose/);
	assert.throws(() => assertIntegrationArtifact(artifact(baseline), 'invalid', 'rollback', baseline), /source/);
	assert.throws(() => loadRollbackArtifact({}, current), /requires an identified rollback artifact/);
});

import assert from 'node:assert/strict';

/**
 * Evidence contract: twelve complete cold loads and no new hydration. The JS stays the
 * baseline's, except for declared changes: each names its reason and the exact baseline
 * and candidate artifacts, so any other change still fails.
 */
export function assertNataliaComparison(measurements, declaredChanges = []) {
	assert(
		Array.isArray(measurements) && measurements.length === 12,
		'Missing Natalia performance samples.'
	);
	for (const label of ['baseline', 'candidate'])
		for (const width of [390, 1280]) {
			const samples = measurements.filter((item) => item.label === label && item.width === width);
			assert.deepEqual(samples.map((item) => item.repetition).sort(), [1, 2, 3]);
			for (const sample of samples) {
				assert.equal(
					sample.frameworkHydration.islands,
					0,
					'Unexpected framework hydration islands.'
				);
				assert.equal(sample.frameworkHydration.events, 0, 'Unexpected framework hydration events.');
				assert.equal(
					sample.frameworkHydration.durationMs,
					null,
					'Do not fabricate a zero hydration duration.'
				);
				assert(Number.isFinite(sample.domContentLoadedMs) && sample.domContentLoadedMs > 0);
				assert.equal(sample.scripts.length, sample.artifacts.scripts.length);
				for (const script of sample.scripts) {
					assert(
						script.encodedBodyBytes > 0 &&
							script.decodedBodyBytes > 0 &&
							script.browserTransferBytes > 0,
						'Missing actual cold script transfer.'
					);
					assert(
						sample.artifacts.scripts.some(
							(item) =>
								script.path.endsWith('/' + item.name) && script.decodedBodyBytes === item.bytes
						)
					);
				}
			}
		}
	for (const change of declaredChanges)
		assert(typeof change.reason === 'string' && change.reason.trim(), 'A declared Natalia change needs its reason.');
	const reference = measurements.find((item) => item.label === 'baseline');
	const candidateReference = measurements.find((item) => item.label === 'candidate');
	const expected = expectedCandidateScripts(reference.artifacts.scripts, declaredChanges);
	for (const sample of measurements) {
		const candidate = sample.label === 'candidate';
		assert.deepEqual(
			sample.artifacts.scripts,
			candidate ? expected : reference.artifacts.scripts,
			'JS artifacts changed from the pinned baseline.'
		);
		assert.equal(
			sample.artifacts.inlineSourceBytes,
			reference.artifacts.inlineSourceBytes,
			'Inline JS changed from the pinned baseline.'
		);
		assert.deepEqual(
			sample.scripts,
			(candidate ? candidateReference : reference).scripts,
			'Measured JS transfer changed from the pinned baseline.'
		);
		if (!candidate) continue;
		// An unchanged artifact keeps the baseline's transfer; only a declared one may differ.
		for (const script of sample.scripts) {
			const unchanged = reference.scripts.find((item) => item.path === script.path);
			if (unchanged) assert.deepEqual(script, unchanged, 'Measured JS transfer changed from the pinned baseline.');
			else
				assert(
					declaredChanges.some((change) => script.path.endsWith('/' + change.candidate.name)),
					'Measured JS transfer changed from the pinned baseline.'
				);
		}
	}
	return measurements.length;
}

function expectedCandidateScripts(baselineScripts, declaredChanges) {
	const scripts = [...baselineScripts];
	for (const change of declaredChanges) {
		const index = scripts.findIndex(
			(script) =>
				script.name === change.baseline.name &&
				script.bytes === change.baseline.bytes &&
				script.sha256 === change.baseline.sha256
		);
		assert(index >= 0, 'A declared Natalia change no longer matches the pinned baseline.');
		const { name, bytes, sha256 } = change.candidate;
		scripts[index] = { name, bytes, sha256 };
	}
	// The same order in which the measurement lists the built artifacts.
	return scripts.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

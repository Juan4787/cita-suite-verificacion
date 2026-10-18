import assert from 'node:assert/strict';

/** Evidence contract: twelve complete cold loads, unchanged JS and no new hydration. */
export function assertNataliaComparison(measurements) {
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
	const reference = measurements[0];
	for (const sample of measurements) {
		assert.deepEqual(
			sample.artifacts.scripts,
			reference.artifacts.scripts,
			'JS artifacts changed from the pinned baseline.'
		);
		assert.equal(
			sample.artifacts.inlineSourceBytes,
			reference.artifacts.inlineSourceBytes,
			'Inline JS changed from the pinned baseline.'
		);
		assert.deepEqual(
			sample.scripts,
			reference.scripts,
			'Measured JS transfer changed from the pinned baseline.'
		);
	}
	return measurements.length;
}

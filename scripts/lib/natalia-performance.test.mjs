import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNataliaComparison } from './natalia-performance.mjs';

const valid = () =>
	['baseline', 'candidate'].flatMap((label) =>
		[390, 1280].flatMap((width) =>
			[1, 2, 3].map((repetition) => ({
				label,
				width,
				repetition,
				domContentLoadedMs: 15,
				artifacts: {
					inlineSourceBytes: 100,
					scripts: [{ name: 'public.hash.js', bytes: 1000, sha256: 'synthetic-content-hash' }]
				},
				scripts: [
					{
						path: '/_astro/public.hash.js',
						encodedBodyBytes: 500,
						decodedBodyBytes: 1000,
						browserTransferBytes: 800
					}
				],
				frameworkHydration: { islands: 0, events: 0, durationMs: null }
			}))
		)
	);
test('Natalia comparison requires all cold loads with actual transfer and keeps hydration distinct from JS execution', () => {
	assert.equal(assertNataliaComparison(valid()), 12);
	const mutations = [
		(report) => report.pop(),
		(report) => {
			report[11].repetition = 2;
		},
		(report) => {
			report[11].scripts[0].encodedBodyBytes = 0;
		},
		(report) => {
			report[11].scripts = [];
		},
		(report) => {
			report[11].frameworkHydration.durationMs = 0;
		},
		(report) => {
			report[11].frameworkHydration.islands = 1;
		}
	];
	for (const mutate of mutations) {
		const report = valid();
		mutate(report);
		assert.throws(() => assertNataliaComparison(report));
	}
});
test('added JS, altered bytecode or extra transfer cannot be reported as unchanged', () => {
	const mutations = [
		(report) => {
			report[11].artifacts.inlineSourceBytes++;
		},
		(report) => {
			report[11].artifacts.scripts[0].sha256 = 'changed-bytecode';
		},
		(report) => {
			report[11].scripts[0].encodedBodyBytes++;
		},
		(report) => {
			report[11].scripts[0].browserTransferBytes++;
		}
	];
	for (const mutate of mutations) {
		const report = valid();
		mutate(report);
		assert.throws(() => assertNataliaComparison(report));
	}
});

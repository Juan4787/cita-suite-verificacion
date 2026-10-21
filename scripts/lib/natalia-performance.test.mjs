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
test('a declared change is accepted only with its reason, its exact artifact and a consistent transfer', () => {
	const change = {
		reason: 'synthetic: the catalogue validates ids like the application',
		baseline: { name: 'public.hash.js', bytes: 1000, sha256: 'synthetic-content-hash' },
		candidate: { name: 'public.next.js', bytes: 990, sha256: 'synthetic-next-hash' }
	};
	const declared = () => {
		const report = valid();
		for (const sample of report.filter((item) => item.label === 'candidate')) {
			sample.artifacts.scripts = [{ ...change.candidate }];
			sample.scripts = [
				{ path: '/_astro/public.next.js', encodedBodyBytes: 495, decodedBodyBytes: 990, browserTransferBytes: 795 }
			];
		}
		return report;
	};
	assert.equal(assertNataliaComparison(declared(), [change]), 12);
	assert.throws(() => assertNataliaComparison(declared()), /JS artifacts changed/);
	const mutations = [
		[(report) => report, { ...change, reason: ' ' }],
		[(report) => report, { ...change, candidate: { ...change.candidate, sha256: 'other-hash' } }],
		[(report) => report, { ...change, baseline: { ...change.baseline, sha256: 'stale-baseline-hash' } }],
		[
			(report) => {
				report[11].scripts[0].encodedBodyBytes++;
			},
			change
		],
		[
			(report) => {
				report[11].artifacts.inlineSourceBytes++;
			},
			change
		]
	];
	for (const [mutate, declaration] of mutations) {
		const report = declared();
		mutate(report);
		assert.throws(() => assertNataliaComparison(report, [declaration]));
	}
});

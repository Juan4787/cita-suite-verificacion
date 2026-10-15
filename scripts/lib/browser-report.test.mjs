import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertBrowserReport } from './browser-report.mjs';

const valid = () => ({
	stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }, errors: [],
	suites: [{ specs: [{ ok: true, tests: [{ expectedStatus: 'passed', status: 'expected',
		results: [{ status: 'passed', retry: 0, errors: [] }] }] }] }]
});
test('only an actually executed successful browser result closes verification', () => {
	assert.equal(assertBrowserReport(valid()), 1);
});
test('an empty, omitted or contradictory suite cannot pass verification', () => {
	assert.throws(() => assertBrowserReport({ stats: { expected: 0, unexpected: 0, skipped: 0, flaky: 0 }, errors: [], suites: [] }));
	const report = valid(); report.suites = [];
	assert.throws(() => assertBrowserReport(report), /count/);
	const omitted = valid(); omitted.suites[0].specs[0].tests[0].results = [];
	assert.throws(() => assertBrowserReport(omitted), /missing/);
});
test('failure, interruption, skipped execution and retry cannot be reported as success', () => {
	for (const status of ['failed', 'timedOut', 'skipped', 'interrupted']) {
		const report = valid(); report.suites[0].specs[0].tests[0].results[0].status = status;
		assert.throws(() => assertBrowserReport(report), /missing/);
	}
	const report = valid(); report.suites[0].specs[0].tests[0].results[0].retry = 1;
	assert.throws(() => assertBrowserReport(report), /retried/);
	const globalFailure = valid(); globalFailure.errors = [{ message: 'Setup interrupted' }];
	assert.throws(() => assertBrowserReport(globalFailure));
});

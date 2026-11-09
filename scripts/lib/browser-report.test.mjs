import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANDIDATE_BEHAVIOR_TAG, assertBrowserReport, browserGrepInvert } from './browser-report.mjs';

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

test('only the rollback-compatibility profile leaves out tests of new behavior', () => {
	assert.equal(browserGrepInvert(false), 'Reserva pública - modo demo|Google Auth');
	assert.equal(browserGrepInvert(true), `Reserva pública - modo demo|Google Auth|${CANDIDATE_BEHAVIOR_TAG}`);
});

const withSkip = (file, title, reason = 'A limit of the local fixture in this engine.') => {
	const report = valid();
	report.stats.skipped = 1;
	report.suites[0].specs.push({ ok: true, file, title, tests: [{ expectedStatus: 'skipped', status: 'skipped',
		annotations: reason ? [{ type: 'skip', description: reason }] : [], results: [{ status: 'skipped', retry: 0, errors: [] }] }] });
	return report;
};
const declaredWebKit = ['request-transport.spec.ts', 'browser fixture transport preserves Secure loopback cookies without inventing authentication or following redirects'];

test('an engine may skip only its declared limits, each with its own reason', () => {
	assert.equal(assertBrowserReport(withSkip(...declaredWebKit), { engine: 'webkit' }), 1);
	assert.throws(() => assertBrowserReport(withSkip(...declaredWebKit)), /skipped/);
	assert.throws(() => assertBrowserReport(withSkip(...declaredWebKit), { engine: 'firefox' }), /skipped/);
	assert.throws(() => assertBrowserReport(withSkip('booking-embed.spec.ts', 'any other test'), { engine: 'webkit' }), /declared/);
	assert.throws(() => assertBrowserReport(withSkip(...declaredWebKit, ''), { engine: 'webkit' }), /declared/);
	const miscounted = withSkip(...declaredWebKit); miscounted.stats.skipped = 0;
	assert.throws(() => assertBrowserReport(miscounted, { engine: 'webkit' }), /count/);
});

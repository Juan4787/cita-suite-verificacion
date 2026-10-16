import assert from 'node:assert/strict';
import test from 'node:test';
import { assertUnitReport } from './unit-report.mjs';

const valid = () => ({ success: true, numTotalTests: 1, numPassedTests: 1,
	numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
	testResults: [{ status: 'passed', assertionResults: [{ status: 'passed', failureMessages: [] }] }] });

test('requires counted results, rejecting success with skipped or missing tests', () => {
	assert.equal(assertUnitReport(valid()), 1);
	for (const patch of [{ success: false }, { numTotalTests: 0, numPassedTests: 0 },
		{ numPendingTests: 1 }, { numTodoTests: 1 }, { numFailedTests: 1 },
		{ testResults: [] }, { numTotalTests: 2, numPassedTests: 2 }]) {
		assert.throws(() => assertUnitReport({ ...valid(), ...patch }));
	}
	for (const status of ['pending', 'skipped', 'failed', 'todo']) {
		const report = valid();
		report.testResults[0].assertionResults[0].status = status;
		assert.throws(() => assertUnitReport(report));
	}
	const report = valid();
	report.testResults[0].assertionResults[0].failureMessages = ['hidden failure'];
	assert.throws(() => assertUnitReport(report));
});

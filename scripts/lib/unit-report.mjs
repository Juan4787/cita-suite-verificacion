// A zero exit code is insufficient when a test was pending or skipped.
export function assertUnitReport(report) {
	const fail = () => { throw new Error('Unit verification requires actual passes without omitted, pending, failed or interrupted tests.'); };
	if (report?.success !== true || !Number.isSafeInteger(report.numTotalTests) || report.numTotalTests < 1 ||
		report.numPassedTests !== report.numTotalTests || report.numFailedTests !== 0 ||
		report.numPendingTests !== 0 || report.numTodoTests !== 0 ||
		!Array.isArray(report.testResults) || report.testResults.length === 0) fail();
	let passed = 0;
	for (const file of report.testResults) {
		if (file.status !== 'passed' || !Array.isArray(file.assertionResults) || file.assertionResults.length === 0) fail();
		for (const test of file.assertionResults) {
			if (test.status !== 'passed' || !Array.isArray(test.failureMessages) || test.failureMessages.length !== 0) fail();
			passed++;
		}
	}
	if (passed !== report.numPassedTests) fail();
	return passed;
}

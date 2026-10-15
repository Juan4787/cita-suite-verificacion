// Playwright can exit successfully when selected tests are skipped. A successful
// process is necessary, but actual, non-retried passes are also required.
export function assertBrowserReport(report) {
	const stats = report?.stats;
	if (!stats || !Number.isSafeInteger(stats.expected) || stats.expected < 1 ||
		stats.unexpected !== 0 || stats.skipped !== 0 || stats.flaky !== 0 ||
		!Array.isArray(report.errors) || report.errors.length || !Array.isArray(report.suites))
		throw new Error('Browser verification requires actual passes without missing, failed, skipped, interrupted or flaky tests.');
	let passed = 0;
	function visit(suites) {
		for (const suite of suites) {
			if (!Array.isArray(suite.specs)) throw new Error('Incomplete browser suite report.');
			for (const spec of suite.specs) {
				if (spec.ok !== true || !Array.isArray(spec.tests) || !spec.tests.length)
					throw new Error('Incomplete browser test report.');
				for (const test of spec.tests) {
					if (test.expectedStatus !== 'passed' || test.status !== 'expected' ||
						!Array.isArray(test.results) || test.results.length !== 1 ||
						test.results[0].status !== 'passed' || test.results[0].retry !== 0 ||
						!Array.isArray(test.results[0].errors) || test.results[0].errors.length)
						throw new Error('Browser verification contains a missing, failed, skipped, interrupted or retried test.');
					passed++;
				}
			}
			visit(suite.suites ?? []);
		}
	}
	visit(report.suites);
	if (passed !== stats.expected) throw new Error('Browser pass count does not match the actual test results.');
	return passed;
}

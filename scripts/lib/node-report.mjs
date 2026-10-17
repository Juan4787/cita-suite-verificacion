import { resolve } from 'node:path';

export function assertNodeReport(summaries, expectedFiles) {
	if (!Array.isArray(summaries) || !Array.isArray(expectedFiles) || expectedFiles.length === 0)
		throw new Error('Required Node test files and completed summaries are missing.');
	const expected = new Set(expectedFiles.map(file => resolve(file)));
	if (expected.size !== expectedFiles.length) throw new Error('Duplicate required Node test file.');
	const seen = new Set();
	let cumulative;
	let total = 0;
	for (let index = 0; index < summaries.length; index++) {
		const summary = summaries[index];
		const counts = summary?.counts;
		if (summary?.success !== true || !counts || !Number.isSafeInteger(counts.tests) || counts.tests <= 0 ||
			counts.passed !== counts.tests || ['failed', 'cancelled', 'skipped', 'todo'].some(key => counts[key] !== 0))
			throw new Error('A required Node test file was empty, failed, skipped, pending or interrupted.');
		if (summary.file === undefined) {
			if (cumulative || index !== summaries.length - 1) throw new Error('Missing or contradictory final Node summary.');
			cumulative = summary;
		} else {
			if (typeof summary.file !== 'string') throw new Error('Invalid Node test file identity.');
			const file = resolve(summary.file);
			if (!expected.has(file) || seen.has(file)) throw new Error('Unexpected or duplicated Node test file summary.');
			seen.add(file); total += counts.tests;
		}
	}
	if (!cumulative || seen.size !== expected.size || cumulative.counts.tests !== total)
		throw new Error('A required Node suite or its complete report was omitted.');
	return total;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNodeReport } from './node-report.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const summary = (file, tests = 2) => ({ ...(file ? { file } : {}), success: true,
	counts: { tests, passed: tests, suites: 0, topLevel: tests, failed: 0, cancelled: 0, skipped: 0, todo: 0 } });
const files = ['synthetic-one.test.mjs', 'synthetic-two.test.mjs'];
const valid = () => [summary(files[0]), summary(files[1]), summary(undefined, 4)];

test('each required file and the final summary must agree on executed successful tests', () => {
	assert.equal(assertNodeReport(valid(), files), 4);
});
test('empty files, skips, todos, cancelled or failed tests cannot produce a green guard suite', () => {
	for (const counter of ['skipped', 'todo', 'cancelled', 'failed']) {
		const report = valid(); report[0].counts[counter] = 1;
		assert.throws(() => assertNodeReport(report, files));
	}
	const empty = valid(); empty[0] = summary(files[0], 0);
	assert.throws(() => assertNodeReport(empty, files));
	const unsuccessful = valid(); unsuccessful[0].success = false;
	assert.throws(() => assertNodeReport(unsuccessful, files));
});
test('omitted, duplicated, unexpected or truncated file summaries cannot pass', () => {
	for (const report of [[], valid().slice(0, 2), valid().slice(1), [...valid(), summary(undefined, 4)],
		[summary(files[0]), summary(files[0]), summary(undefined, 4)],
		[summary('foreign.test.mjs'), summary(files[1]), summary(undefined, 4)]]) {
		assert.throws(() => assertNodeReport(report, files));
	}
});
test('a forged cumulative count or pass count is rejected', () => {
	const wrongTotal = valid(); wrongTotal[2].counts.tests = wrongTotal[2].counts.passed = 8;
	assert.throws(() => assertNodeReport(wrongTotal, files));
	const wrongPass = valid(); wrongPass[0].counts.passed = 1;
	assert.throws(() => assertNodeReport(wrongPass, files));
});

test('actual Node receipts reject empty files and skipped tests even though Node exits successfully', () => {
	const directory = mkdtempSync(join(tmpdir(), 'cita-node-report-negative-'));
	const reporter = fileURLToPath(new URL('./node-summary-reporter.mjs', import.meta.url));
	const environment = { ...process.env };
	delete environment.NODE_TEST_CONTEXT;
	try {
		for (const [name, source] of [
			['empty', ''],
			['import-only', "import 'node:test';"],
			['skipped', "import {test} from 'node:test'; test.skip('omitted case',()=>{});"]
		]) {
			const file = join(directory, name + '.test.mjs');
			const report = join(directory, name + '.log');
			writeFileSync(file, source);
			const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=' + reporter,
				'--test-reporter-destination=' + report, file], { encoding: 'utf8', timeout: 10000, env: environment });
			assert.equal(result.status, 0, result.stderr);
			const summaries = readFileSync(report, 'utf8').trim().split('\n').map(line => JSON.parse(line));
			assert.throws(() => assertNodeReport(summaries, [file]), /empty|omitted|skipped/);
		}
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { assertNodeReport } from './lib/node-report.mjs';
import { runVerificationProcess } from './lib/verification-process.mjs';
import { assertLightVerificationResources } from './lib/verification-resources.mjs';

assertLightVerificationResources();
const root = fileURLToPath(new URL('../', import.meta.url));
const runId = process.env.CITA_VERIFICATION_RUN_ID ?? randomUUID();
if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('Invalid verification run identifier.');
const directory = join(root, '.verification', 'runs', runId, 'units');
mkdirSync(directory, { recursive: true });
const reportPath = join(directory, 'node-' + randomUUID() + '.log');
const files = readdirSync(join(root, 'scripts/lib')).filter(file => file.endsWith('.test.mjs')).sort().map(file => join(root, 'scripts/lib', file));
if (!files.length) throw new Error('Required Node guard test files are missing.');
const controller = new AbortController();
const interrupt = () => controller.abort();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, interrupt);
try {
	const result = await runVerificationProcess(process.execPath, ['--test', '--test-concurrency=1',
		'--test-reporter=tap', '--test-reporter-destination=stdout',
		'--test-reporter=./scripts/lib/node-summary-reporter.mjs', '--test-reporter-destination=' + reportPath,
		...files], { cwd: root, env: process.env, stdio: 'inherit', signal: controller.signal });
	if (result.status !== 0 || result.signal || result.error || controller.signal.aborted)
		throw new Error('Required Node guard tests did not complete successfully.');
	const summaries = readFileSync(reportPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
	const passed = assertNodeReport(summaries, files);
	console.log(JSON.stringify({ profile: 'node-guards', passed, files: files.length, skipped: 0, report: reportPath }));
} catch (error) {
	console.error(error.message); process.exitCode = 1;
} finally {
	for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupt);
}

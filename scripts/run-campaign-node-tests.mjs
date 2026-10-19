import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { assertNodeReport } from './lib/node-report.mjs';
import { runVerificationProcess } from './lib/verification-process.mjs';
import { assertLightVerificationResources } from './lib/verification-resources.mjs';

// Suites that run on Node's own test runner. The scheduler Worker's tests use the
// native TypeScript type stripping of the pinned Node version, so it needs no bundler.
const profiles = {
	'node-guards': { directory: 'scripts/lib', suffix: '.test.mjs', label: 'Required Node guard' },
	scheduler: { directory: 'apps/scheduler/src', suffix: '.test.ts', label: 'Scheduler' }
};
const name = process.argv[2] ?? 'node-guards';
const profile = profiles[name];
if (!profile || process.argv.length > 3) throw new Error('Usage: node scripts/run-campaign-node-tests.mjs [node-guards|scheduler]');

assertLightVerificationResources();
const root = fileURLToPath(new URL('../', import.meta.url));
const runId = process.env.CITA_VERIFICATION_RUN_ID ?? randomUUID();
if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('Invalid verification run identifier.');
const directory = join(root, '.verification', 'runs', runId, 'units');
mkdirSync(directory, { recursive: true });
const reportPath = join(directory, 'node-' + randomUUID() + '.log');
const files = readdirSync(join(root, profile.directory)).filter(file => file.endsWith(profile.suffix)).sort().map(file => join(root, profile.directory, file));
if (!files.length) throw new Error(`${profile.label} test files are missing.`);
const controller = new AbortController();
const interrupt = () => controller.abort();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, interrupt);
try {
	const result = await runVerificationProcess(process.execPath, ['--test', '--test-concurrency=1',
		'--test-reporter=tap', '--test-reporter-destination=stdout',
		'--test-reporter=./scripts/lib/node-summary-reporter.mjs', '--test-reporter-destination=' + reportPath,
		...files], { cwd: root, env: process.env, stdio: 'inherit', signal: controller.signal });
	if (result.status !== 0 || result.signal || result.error || controller.signal.aborted)
		throw new Error(`${profile.label} tests did not complete successfully.`);
	const summaries = readFileSync(reportPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
	const passed = assertNodeReport(summaries, files);
	console.log(JSON.stringify({ profile: name, passed, files: files.length, skipped: 0, report: reportPath }));
} catch (error) {
	console.error(error.message); process.exitCode = 1;
} finally {
	for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupt);
}

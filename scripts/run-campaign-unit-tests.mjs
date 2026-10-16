import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { assertUnitReport } from './lib/unit-report.mjs';
import { runVerificationProcess } from './lib/verification-process.mjs';
import { assertHostedIntegrationResources, assertLightVerificationResources } from './lib/verification-resources.mjs';

const mode = process.argv[2];
if (!['server', 'client', 'office'].includes(mode) || process.argv.length !== 3)
	throw new Error('Usage: run-campaign-unit-tests.mjs server|client|office');
if (mode === 'office') assertHostedIntegrationResources();
assertLightVerificationResources();
const root = fileURLToPath(new URL('../', import.meta.url));
const runId = process.env.CITA_VERIFICATION_RUN_ID ?? randomUUID();
if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('Invalid verification run identifier.');
const directory = join(root, '.verification', 'runs', runId, 'units');
mkdirSync(directory, { recursive: true });
const reportPath = join(directory, mode + '-' + randomUUID() + '.json');
const config = mode === 'server' ? [] : ['--config', 'vitest.' + mode + '.config.ts'];
const controller = new AbortController();
const interrupt = () => controller.abort();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, interrupt);
try {
	const result = await runVerificationProcess('pnpm', ['--filter', 'web', 'exec', 'vitest', 'run',
		...config, '--maxWorkers=1', '--fileParallelism=false', '--allowOnly=false', '--retry=0',
		'--reporter=default', '--reporter=json', '--outputFile=' + reportPath], {
		cwd: root, env: { ...process.env, CI: 'true' }, stdio: 'inherit', signal: controller.signal
	});
	if (result.status !== 0 || result.signal || result.error || controller.signal.aborted)
		throw new Error('The required ' + mode + ' tests did not complete successfully.');
	const count = assertUnitReport(JSON.parse(readFileSync(reportPath, 'utf8')));
	console.log(JSON.stringify({ profile: mode, passed: count, skipped: 0, report: reportPath }));
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
} finally {
	for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupt);
}

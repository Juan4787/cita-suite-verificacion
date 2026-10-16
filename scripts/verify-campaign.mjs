import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { acquireVerificationLock } from './lib/verification-lock.mjs';
import { runVerificationProcess } from './lib/verification-process.mjs';
import { loadStagingEnvironment } from './lib/staging-environment.mjs';
import { assertHostedIntegrationResources, assertLightVerificationResources } from './lib/verification-resources.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const level = process.argv[2];
if (!['fast', 'full', 'release'].includes(level) || process.argv.length !== 3)
	throw new Error('Usage: node scripts/verify-campaign.mjs fast|full|release');

const steps = [
	['approved-plan', 'node', ['scripts/check-refactoring-plan.mjs']],
	['inventory', 'node', ['scripts/inventory-campaign.mjs']],
	['shared-types', 'pnpm', ['--filter', '@turnos-saas/shared', 'check']],
	['web-types', 'pnpm', ['--filter', 'web', 'check']],
	['natalia-types', 'pnpm', ['--filter', 'natalia', 'check']],
	['verification-runner-tests', 'node', ['--test', '--test-concurrency=1', 'scripts/lib/verification-lock.test.mjs', 'scripts/lib/architecture.test.mjs', 'scripts/lib/e2e-environment.test.mjs', 'scripts/lib/browser-report.test.mjs', 'scripts/lib/verification-process.test.mjs', 'scripts/lib/staging-environment.test.mjs', 'scripts/lib/verification-resources.test.mjs', 'scripts/lib/verification-images.test.mjs', 'scripts/lib/fixture-cleanup.test.mjs']],
	['evidence-recovery-tests', 'python3', ['scripts/test-verification-evidence.py']],
	['architecture', 'pnpm', ['check:architecture']],
	['server-tests', 'pnpm', ['--filter', 'web', 'test']],
	['client-tests', 'pnpm', ['--filter', 'web', 'test:client']]
];
if (level !== 'fast') steps.push(
	['database-auth-storage-browser', 'node', ['scripts/run-campaign-integration.mjs']],
	['demo-browser', 'node', ['scripts/run-campaign-demo.mjs']]
);
if (level === 'release') steps.push(
	['cloudflare-build', 'pnpm', ['--filter', 'web', 'build:cloudflare']],
	['natalia-build', 'pnpm', ['--filter', 'natalia', 'build']],
	['staging', 'node', ['scripts/verify-campaign-staging.mjs']]
);

const evidence = { runId: randomUUID(), level, startedAt: new Date().toISOString(), steps: [], ok: false };
const lease = acquireVerificationLock(root);
const controller = new AbortController();
const directory = join(root, '.verification');
mkdirSync(directory, { recursive: true });
const runDirectory = join(directory, 'runs', evidence.runId);
mkdirSync(runDirectory, { recursive: true });
process.env.CITA_VERIFICATION_RUN_ID = evidence.runId;
function saveEvidence() {
	const temporary = join(directory, `${level}.${evidence.runId}.tmp`);
	writeFileSync(temporary, JSON.stringify(evidence, null, 2) + '\n');
	renameSync(temporary, join(directory, `${level}.json`));
	const runTemporary = join(runDirectory, 'result.tmp');
	writeFileSync(runTemporary, JSON.stringify(evidence, null, 2) + '\n');
	renameSync(runTemporary, join(runDirectory, 'result.json'));
}
const interrupt = () => controller.abort();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, interrupt);
try {
	// A killed invocation must never leave a previous successful receipt current.
	saveEvidence();
	// Reject an absent or unsafe release target before spending time on local
	// verification. Never build Natalia against production .env fallbacks.
	const staging = level === 'release' ? loadStagingEnvironment(root, process.env) : null;
	if (level !== 'fast') assertHostedIntegrationResources();
	for (const [name, command, args] of steps) {
		assertLightVerificationResources();
		console.log(`\n[verify:${level}] ${name}`);
		const started = performance.now();
		const result = await runVerificationProcess(command, args, {
			cwd: root, stdio: 'inherit', signal: controller.signal,
			env: { ...process.env, CI: 'true', ASTRO_TELEMETRY_DISABLED: '1',
				...(staging && ['cloudflare-build', 'natalia-build'].includes(name) ? {
					CITA_BUILD_VERSION: staging.descriptor.revision,
					PUBLIC_CITA_BASE_URL: staging.app.origin,
					PUBLIC_NATALIA_INTEGRATION_KEY: staging.descriptor.bookingIntegrationKey,
					NATALIA_LOCAL_FIXTURE: 'false'
				} : {}) }
		});
		evidence.steps.push({ name, status: result.status, signal: result.signal, durationMs: Math.round(performance.now() - started) });
		saveEvidence();
		if (controller.signal.aborted || result.error || result.status !== 0)
			throw new Error(`${name} failed${result.signal ? ` (${result.signal})` : ''}. Subsequent stages were not executed.`, { cause: result.error });
	}
	evidence.ok = true;
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
} finally {
	evidence.finishedAt = new Date().toISOString();
	saveEvidence();
	for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupt);
	lease.release();
}

import os from 'node:os';
import { readFileSync } from 'node:fs';

const GiB = 1024 ** 3;
export function readVerificationResources() {
	let availableMemoryBytes = os.freemem();
	if (process.platform === 'linux') {
		const match = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB$/m);
		if (match) availableMemoryBytes = Number(match[1]) * 1024;
	}
	return { totalMemoryBytes: os.totalmem(), availableMemoryBytes, cpus: os.cpus().length };
}

export function assertLightVerificationResources(resources = readVerificationResources()) {
	if (resources.availableMemoryBytes < 2 * GiB)
		throw new Error('Insufficient available RAM for local verification. No new test process was started. Use the isolated CI workflow.');
}

export function assertHostedIntegrationResources(env = process.env, resources = readVerificationResources()) {
	if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted')
		throw new Error('Browser/database integration runs only in the isolated GitHub-hosted workflow. Local execution was disabled after measured RAM exhaustion; no services were started.');
	if (resources.totalMemoryBytes < 12 * GiB || resources.availableMemoryBytes < 6 * GiB || resources.cpus < 4)
		throw new Error('Insufficient hosted runner resources. No integration services were started.');
}

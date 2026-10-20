import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGING_APP_WORKER } from './lib/staging-deploy.mjs';
import { jobMeasurement, splitJsonObjects, summarizeJobMeasurements } from './lib/staging-tail.mjs';

// Observes the staging app Worker for a bounded time and keeps only what measures
// the scheduled jobs: outcome, CPU and wall time when the platform reports them,
// the job path and the job's own log of counts. Headers, other logs and any other
// traffic are discarded as they arrive.
const root = fileURLToPath(new URL('../', import.meta.url));
const [run, minutesArgument] = process.argv.slice(2);
const minutes = Number(minutesArgument);
if (!/^[a-f0-9]{12}$/.test(run ?? '') || !Number.isInteger(minutes) || minutes < 1 || minutes > 90 || process.argv.length !== 4)
	throw new Error('Usage: staging-tail-metrics.mjs <run> <minutes 1-90>');
mkdirSync(join(root, '.verification'), { recursive: true });
const output = join(root, `.verification/staging-tail-${run}.jsonl`);
writeFileSync(output, '');

const measurements = [];
const tail = spawn('pnpm', ['--filter', 'web', 'exec', 'wrangler', 'tail', STAGING_APP_WORKER, '--format', 'json'],
	{ cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
const split = splitJsonObjects(text => {
	let event = null;
	try { event = JSON.parse(text); } catch { return; }
	const measurement = jobMeasurement(event);
	if (!measurement) return;
	measurements.push(measurement);
	appendFileSync(output, JSON.stringify(measurement) + '\n');
});
tail.stdout.setEncoding('utf8').on('data', split);
const stop = setTimeout(() => tail.kill('SIGINT'), minutes * 60_000);
const status = await new Promise(done => tail.on('close', code => done(code)));
clearTimeout(stop);
const summary = { run, worker: STAGING_APP_WORKER, minutes, tailExit: status, ...summarizeJobMeasurements(measurements) };
writeFileSync(join(root, `.verification/staging-tail-${run}-summary.json`), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

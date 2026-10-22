import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_APP_WORKER } from './lib/production-deploy.mjs';
import { STAGING_APP_WORKER } from './lib/staging-deploy.mjs';
import {
	jobMeasurement, requestMeasurement, splitJsonObjects, summarizeJobMeasurements, summarizeRequestMeasurements
} from './lib/worker-tail.mjs';

// Observes the app Worker of staging or production for a bounded time and keeps only what
// measures it: outcome, CPU and wall time when the platform reports them. `jobs` keeps the
// scheduled job requests with the job's own log of counts; `requests` keeps every request by
// method and route template, for the capacity measurements. Headers, query strings,
// identifiers, other logs and any other data are discarded as they arrive, so a production
// tail keeps no patient, practice or link data either. Read-only: it changes nothing.
const WORKERS = { staging: STAGING_APP_WORKER, production: PRODUCTION_APP_WORKER };
const root = fileURLToPath(new URL('../', import.meta.url));
const [target, run, minutesArgument, mode = 'jobs'] = process.argv.slice(2);
const minutes = Number(minutesArgument);
if (!Object.hasOwn(WORKERS, target ?? '') || !/^[a-f0-9]{12}$/.test(run ?? '') || !Number.isInteger(minutes) || minutes < 1 || minutes > 90 ||
	!['jobs', 'requests'].includes(mode) || process.argv.length > 6)
	throw new Error('Usage: tail-metrics.mjs staging|production <run> <minutes 1-90> [jobs|requests]');
const worker = WORKERS[target];
const measure = mode === 'jobs' ? jobMeasurement : requestMeasurement;
const summarize = mode === 'jobs' ? summarizeJobMeasurements : summarizeRequestMeasurements;
mkdirSync(join(root, '.verification'), { recursive: true });
const output = join(root, `.verification/${target}-tail-${run}.jsonl`);
writeFileSync(output, '');

const measurements = [];
const tail = spawn('pnpm', ['--filter', 'web', 'exec', 'wrangler', 'tail', worker, '--format', 'json'],
	{ cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
const split = splitJsonObjects(text => {
	let event = null;
	try { event = JSON.parse(text); } catch { return; }
	const measurement = measure(event);
	if (!measurement) return;
	measurements.push(measurement);
	appendFileSync(output, JSON.stringify(measurement) + '\n');
});
tail.stdout.setEncoding('utf8').on('data', split);
const stop = setTimeout(() => tail.kill('SIGINT'), minutes * 60_000);
const status = await new Promise(done => tail.on('close', code => done(code)));
clearTimeout(stop);
const summary = { run, target, worker, mode, minutes, tailExit: status, ...summarize(measurements) };
writeFileSync(join(root, `.verification/${target}-tail-${run}-summary.json`), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

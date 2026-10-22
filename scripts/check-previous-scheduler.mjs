import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvFile } from './lib/production-database.mjs';

// The previous scheduler and the retired copies of the app, in read-only, before the new scheduler
// is activated (step 6 of the plan's publication: stop the previous scheduler and wait for its
// active runs). Every cron-job.org job of the account must be disabled, and neither retired copy may
// serve the app: Netlify (`cita-suite.netlify.app`) and Vercel (`cita-suite-app.vercel.app`). The
// receipt keeps job ids, titles and states, and the copies' HTTP statuses; never the API key.
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length !== 2) throw new Error('Usage: check-previous-scheduler.mjs');
const RETIRED_COPIES = ['https://cita-suite.netlify.app', 'https://cita-suite-app.vercel.app'];
const key = readEnvFile(join(root, '.env')).CRON_JOB_ORG_API_KEY ?? '';
if (key.length < 16) throw new Error('The cron-job.org API key is missing from the private configuration. Nothing was read.');

const response = await fetch('https://api.cron-job.org/jobs', { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
const listing = response.ok ? await response.json().catch(() => null) : null;
if (!Array.isArray(listing?.jobs)) throw new Error(`cron-job.org did not list its jobs (HTTP ${response.status}).`);
const jobs = listing.jobs.map((job) => ({ jobId: job.jobId, title: String(job.title ?? '').slice(0, 80), enabled: job.enabled === true }));
const copies = [];
for (const origin of RETIRED_COPIES) {
	const answer = await fetch(`${origin}/login`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) }).catch(() => null);
	copies.push({ origin, status: answer?.status ?? 0 });
}
const receipt = { at: new Date().toISOString(), jobs, copies,
	passed: jobs.every((job) => !job.enabled) && copies.every((copy) => copy.status !== 200 && !(copy.status >= 300 && copy.status < 400)) };
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, `.verification/previous-scheduler-${receipt.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
if (!receipt.passed) process.exitCode = 1;

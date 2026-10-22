import { readFileSync } from 'node:fs';

// Compares the instance metrics (instance-sampler.mjs) of the windows in which a request was
// slow with the other windows of the same measurement. The metrics endpoint refreshes about
// once a minute, so a window spans two distinct refreshes. Counters become rates per second;
// CPU modes, fractions of the instance's CPU time. Requests come from staging-tail-metrics.mjs.
const [samplesPath, requestsPath, thresholdArgument = '2000'] = process.argv.slice(2);
if (!samplesPath || !requestsPath) throw new Error('Usage: attribute-pauses.mjs <instance samples.jsonl> <tail requests.jsonl> [slow ms]');
const slowMs = Number(thresholdArgument);
const lines = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const refreshes = [];
for (const sample of lines(samplesPath).filter((item) => item.kind === 'metrics' && item.values))
	if (!refreshes.length || sample.values.cpu_idle !== refreshes.at(-1).values.cpu_idle) refreshes.push(sample);
const requests = lines(requestsPath);
const slow = requests.filter((request) => request.wallTimeMs >= slowMs && !request.route.startsWith('/internal/'));
const cpus = Object.keys(refreshes[0]?.values ?? {}).length ? 2 : 0;

const RATES = {
	busy: (d, s) => (d('cpu_user') + d('cpu_system')) / (s * cpus),
	steal: (d, s) => d('cpu_steal') / (s * cpus),
	iowait: (d, s) => d('cpu_iowait') / (s * cpus),
	cpuPressure: (d, s) => d('node_pressure_cpu_waiting_seconds_total') / s,
	ioStalled: (d, s) => d('node_pressure_io_stalled_seconds_total') / s,
	memoryStalled: (d, s) => d('node_pressure_memory_stalled_seconds_total') / s,
	swapInPerSecond: (d, s) => d('node_vmstat_pswpin') / s,
	swapOutPerSecond: (d, s) => d('node_vmstat_pswpout') / s,
	majorFaultsPerSecond: (d, s) => d('node_vmstat_pgmajfault') / s,
	diskBusy: (d, s) => d('node_disk_io_time_seconds_total') / s,
	checkpoints: (d) => d('pg_stat_bgwriter_checkpoints_timed_total') + d('pg_stat_bgwriter_checkpoints_req_total')
};
const windows = [];
for (let index = 1; index < refreshes.length; index++) {
	const [before, after] = [refreshes[index - 1], refreshes[index]];
	const from = Date.parse(before.at);
	const to = Date.parse(after.at);
	const seconds = (to - from) / 1000;
	const delta = (key) => (after.values[key] ?? 0) - (before.values[key] ?? 0);
	const rates = Object.fromEntries(Object.entries(RATES).map(([name, rate]) => [name, rate(delta, seconds)]));
	rates.memoryAvailableMb = (after.values.node_memory_MemAvailable_bytes ?? 0) / 1e6;
	windows.push({ from: before.at, slowRequests: slow.filter((request) => request.at < to && request.at + request.wallTimeMs > from).length, ...rates });
}
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const paused = windows.filter((window) => window.slowRequests > 0);
const ordinary = windows.filter((window) => window.slowRequests === 0);
const metrics = Object.keys(windows[0] ?? {}).filter((key) => !['from', 'slowRequests'].includes(key));
console.log(JSON.stringify({
	requests: requests.length, slowRequests: slow.length, slowMs, windows: windows.length,
	withSlowRequests: paused.length, withoutSlowRequests: ordinary.length,
	median: Object.fromEntries(metrics.map((key) => [key, {
		withSlowRequests: median(paused.map((window) => window[key])), withoutSlowRequests: median(ordinary.map((window) => window[key]))
	}])),
	slowWindows: paused
}, null, 2));

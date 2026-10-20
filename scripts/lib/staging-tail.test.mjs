import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobMeasurement, splitJsonObjects, summarizeJobMeasurements } from './staging-tail.mjs';

const jobEvent = (path, extra = {}) => ({
	outcome: 'ok', scriptName: 'cita-suite-staging', eventTimestamp: 1_760_000_000_000, cpuTime: 7, wallTime: 1200,
	event: { request: { url: `https://scheduler.cita-suite.internal${path}?token=QUERY_SENTINEL`, method: 'POST',
		headers: { authorization: 'Bearer HEADER_SENTINEL' } }, response: { status: 200 } },
	logs: [{ level: 'info', message: ['Otro registro', { patient: 'LOG_SENTINEL' }] },
		{ level: 'info', message: ['Tarea programada', { kind: 'push', ok: true, calls: 31, nested: { secret: 'NESTED_SENTINEL' } }] }],
	exceptions: [],
	...extra
});

test('tail events split across chunks and lines are parsed one by one, including braces and quotes inside strings', () => {
	const objects = [];
	const feed = splitJsonObjects(text => objects.push(JSON.parse(text)));
	const text = 'Successfully created tail\n' + JSON.stringify({ a: 'x { "} y', b: { c: '\\"' } }, null, 2) + '\n\n' + JSON.stringify({ d: 1 });
	for (let index = 0; index < text.length; index += 7) feed(text.slice(index, index + 7));
	assert.deepEqual(objects, [{ a: 'x { "} y', b: { c: '\\"' } }, { d: 1 }]);
});

test('only scheduled job requests are measured and nothing beyond their counts survives', () => {
	const measurement = jobMeasurement(jobEvent('/internal/jobs/push'));
	assert.deepEqual(measurement, { at: 1_760_000_000_000, path: '/internal/jobs/push', outcome: 'ok', status: 200, cpuTimeMs: 7, wallTimeMs: 1200,
		exceptions: [], job: { kind: 'push', ok: true, calls: 31 } });
	assert.doesNotMatch(JSON.stringify(measurement), /SENTINEL/);
	assert.equal(jobMeasurement(jobEvent('/odonto/pacientes')), null);
	assert.equal(jobMeasurement({ event: { cron: '*/5 * * * *' } }), null);
	const exceeded = jobMeasurement(jobEvent('/internal/jobs/calendar', { outcome: 'exceededCpu', cpuTime: undefined, logs: [], exceptions: [{ name: 'Error', message: 'MESSAGE_SENTINEL' }] }));
	assert.deepEqual([exceeded.outcome, exceeded.cpuTimeMs, exceeded.job, exceeded.exceptions], ['exceededCpu', null, null, ['Error']]);
	assert.doesNotMatch(JSON.stringify(exceeded), /SENTINEL/);
});

test('the summary reports outcomes and CPU and wall distributions per job', () => {
	const list = [3, 9, 5, 12].map((cpu, index) => ({ ...jobMeasurement(jobEvent('/internal/jobs/push')), cpuTimeMs: cpu, wallTimeMs: 1000 + index }));
	list.push({ ...jobMeasurement(jobEvent('/internal/jobs/push', { outcome: 'exceededCpu' })), cpuTimeMs: null, wallTimeMs: null });
	const summary = summarizeJobMeasurements(list);
	assert.deepEqual(summary.jobs['/internal/jobs/push'], { runs: 5, outcomes: { ok: 4, exceededCpu: 1 },
		cpuMs: { p50: 5, p99: 12, max: 12 }, wallMs: { p50: 1001, p99: 1003, max: 1003 } });
	assert.equal(summary.cpuReported, true);
	assert.equal(summarizeJobMeasurements([{ ...list[4] }]).cpuReported, false);
});

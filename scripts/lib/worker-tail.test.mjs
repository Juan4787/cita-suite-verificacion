import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	jobMeasurement, requestMeasurement, routeTemplate, splitJsonObjects, summarizeJobMeasurements, summarizeRequestMeasurements
} from './worker-tail.mjs';

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

test('every app request is measured by route template, without identifiers, keys, tokens, queries, headers or logs', () => {
	assert.equal(routeTemplate('/odonto/pacientes/0b8c2a52-14d0-4f0b-9a0e-1d2c3b4a5f60/__data.json'), '/odonto/pacientes/:id/__data.json');
	assert.equal(routeTemplate('/embed/v1/0123456789abcdef0123456789abcdef/__data.json'), '/embed/v1/:key/__data.json');
	assert.equal(routeTemplate('/turno/Xy7_aBcDeFgHiJkLmNoPqRsTuVwXyZ01/push'), '/turno/:token/push');
	// Long words without digits are route names, not tokens.
	assert.equal(routeTemplate('/internal/jobs/reconcile-mercadopago'), '/internal/jobs/reconcile-mercadopago');
	const event = jobEvent('/odonto/pacientes/0b8c2a52-14d0-4f0b-9a0e-1d2c3b4a5f60', { outcome: 'exceededCpu', cpuTime: 11, wallTime: 30,
		exceptions: [{ name: 'Error', message: 'MESSAGE_SENTINEL' }] });
	event.event.request.method = 'get';
	const measurement = requestMeasurement(event);
	assert.deepEqual(measurement, { at: 1_760_000_000_000, method: 'GET', route: '/odonto/pacientes/:id', outcome: 'exceededCpu', status: 200,
		cpuTimeMs: 11, wallTimeMs: 30, exceptions: ['Error'] });
	assert.doesNotMatch(JSON.stringify(measurement), /SENTINEL|0b8c2a52/);
	assert.equal(requestMeasurement({ event: { cron: '*/5 * * * *' } }), null);
});

test('management tokens are redacted by their route even when they contain no digits', () => {
	for (const token of ['a'.repeat(64), 'f'.repeat(64), 'AbCdEf'.repeat(8)]) {
		for (const suffix of ['', '/push']) {
			const event = jobEvent(`/turno/${token}${suffix}`);
			const measurement = requestMeasurement(event);
			assert.equal(measurement.route, `/turno/:token${suffix}`);
			assert.equal(JSON.stringify(measurement).includes(token), false);
			// The nested management page exists; its /push child does not. Unknown
			// routes must discard the entire path rather than invent an endpoint.
			assert.equal(routeTemplate(`/embed/v1/${'a'.repeat(32)}/turno/${token}${suffix}`), suffix ? '/:unmatched' : '/embed/v1/:key/turno/:token');
		}
	}
	assert.equal(routeTemplate('/internal/jobs/reconcile-mercadopago'), '/internal/jobs/reconcile-mercadopago');
});

test('the request summary groups outcomes, statuses and CPU per method and route', () => {
	const at = (path, outcome, status, cpu) => {
		const event = jobEvent(path, { outcome, cpuTime: cpu });
		event.event.request.method = 'GET';
		event.event.response = { status };
		return requestMeasurement(event);
	};
	const summary = summarizeRequestMeasurements([at('/odonto/agenda/__data.json', 'ok', 200, 4), at('/odonto/agenda/__data.json', 'exceededCpu', 503, null),
		at('/odonto/agenda/__data.json', 'ok', 200, 14), at('/reservar/0b8c2a52-14d0-4f0b-9a0e-1d2c3b4a5f60/__data.json', 'ok', 200, 6)]);
	assert.deepEqual(summary.outcomes, { ok: 3, exceededCpu: 1 });
	assert.deepEqual(summary.routes['GET /odonto/agenda/__data.json'], { requests: 3, outcomes: { ok: 2, exceededCpu: 1 }, statuses: { 200: 2, 503: 1 },
		cpuMs: { p50: 4, p99: 14, max: 14 }, wallMs: { p50: 1200, p99: 1200, max: 1200 } });
	assert.deepEqual(Object.keys(summary.routes), ['GET /odonto/agenda/__data.json', 'GET /reservar/:id/__data.json']);
});

test('unknown paths and every code-declared dynamic parameter stay private, including short names', () => {
 for (const path of ['/PRIVATE_PATIENT_NAME/copy-secret', '/r/PRIVATE_PATIENT_NAME', '/confirmar/PRIVATE_PATIENT_NAME',
  '/cancelar/PRIVATE_PATIENT_NAME', '/reprogramar/PRIVATE_PATIENT_NAME', '/reservar/PRIVATE_PATIENT_NAME',
  '/odonto/pacientes/PRIVATE_PATIENT_NAME/historial', '/api/public/reservas/PRIVATE_PATIENT_NAME/catalogo']) {
  const result=requestMeasurement(jobEvent(path));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|copy-secret/);
 }
 assert.equal(routeTemplate('/does-not-exist'), '/:unmatched');
 assert.equal(routeTemplate('/odonto/pacientes/papelera'), '/odonto/pacientes/papelera');
 assert.equal(routeTemplate('/odonto/pacientes/PRIVATE_PATIENT_NAME/__data.json'), '/odonto/pacientes/:id/__data.json');
 assert.equal(routeTemplate('/internal/jobs/push'), '/internal/jobs/push');
 assert.equal(routeTemplate('/internal/jobs/UNKNOWN_PRIVATE_KIND'), '/internal/jobs/:kind');
 assert.equal(routeTemplate('/_app/immutable/chunks/PRIVATE_SECRET.js'), '/_app/immutable/:asset');
});

test('job records discard new primitive data fields and unrecognized exception names without changing the observed category', () => {
 const event=jobEvent('/internal/jobs/push');
 event.logs[1].message[1]={kind:'calendar',ok:false,profile:'free',scheduledFor:'2026-10-23T14:20:00.000Z',usedCalls:3,databaseRequests:2,providerRequests:0,elapsedMs:500,patient:'PRIVATE_PATIENT_NAME',patientId:123,token:'PRIVATE_TOKEN',configured:true};
 event.exceptions=[{name:'PRIVATE_PATIENT_NAME'}];
 const m=jobMeasurement(event);
 assert.equal(m.path,'/internal/jobs/push');assert.equal(m.job.kind,'calendar');assert.equal(m.job.ok,false);
 assert.equal(m.job.usedCalls,3);assert.equal(m.job.databaseRequests,2);assert.equal(m.job.providerRequests,0);assert.equal(m.job.configured,true);
 assert.equal(m.job.scheduledFor,'2026-10-23T14:20:00.000Z');assert.deepEqual(m.exceptions,['OtherError']);
 assert.equal(Object.hasOwn(m.job,'patientId'),false);assert.doesNotMatch(JSON.stringify(m),/PRIVATE/);
});

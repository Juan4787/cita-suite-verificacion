import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	ACCEPTANCE, CookieJar, OPERATIONS, classifyResponse, createRandom, evaluateAcceptance, localDate, localDateTime, login,
	pickOperation, planOperation, practiceData, runVirtualUser, summarize
} from './capacity-load.mjs';

const response = (status, body, cookies = []) => {
	const headers = new Headers({ 'content-type': 'application/json' });
	for (const cookie of cookies) headers.append('set-cookie', cookie);
	return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
};

test('the mix is 80 % reads and 20 % writes, and a seed always gives the same choices', () => {
	const share = category => OPERATIONS.filter(operation => operation.category === category).reduce((sum, operation) => sum + operation.weight, 0);
	assert.deepEqual([share('read'), share('write')], [80, 20]);
	const first = createRandom('practice-3');
	const second = createRandom('practice-3');
	assert.deepEqual(Array.from({ length: 20 }, () => pickOperation(first).name), Array.from({ length: 20 }, () => pickOperation(second).name));
	const random = createRandom('distribution');
	const draws = Array.from({ length: 20000 }, () => pickOperation(random).category);
	const reads = draws.filter(category => category === 'read').length / draws.length;
	assert.ok(reads > 0.78 && reads < 0.82, `read share ${reads}`);
});

test('the cookie jar keeps the session like a browser and drops expired cookies', () => {
	const jar = new CookieJar();
	jar.absorb(response(200, {}, ['sb-access-token=abc; Path=/; HttpOnly', 'sb-module=odonto; Path=/', 'other=1; Max-Age=0']));
	assert.equal(jar.header(), 'sb-access-token=abc; sb-module=odonto');
	jar.absorb(response(200, {}, ['sb-access-token=def; Path=/', 'sb-module=; Max-Age=0']));
	assert.equal(jar.header(), 'sb-access-token=def');
	assert.equal(jar.has('sb-module'), false);
});

test('only the system answers expected by the plan count as successes', () => {
	const read = OPERATIONS.find(operation => operation.name === 'agenda_day');
	const write = OPERATIONS.find(operation => operation.name === 'create_appointment');
	assert.equal(classifyResponse(read, 200, { type: 'data', nodes: [] }), 'ok');
	assert.equal(classifyResponse(read, 200, { patients: [] }), 'ok');
	assert.equal(classifyResponse(read, 200, { type: 'redirect', location: '/login' }), 'error');
	// SvelteKit answers a navigation with 200 and puts a failed load in its node.
	assert.equal(classifyResponse(read, 200, { type: 'data', nodes: [{ type: 'data', data: [] }, { type: 'error', status: 503, error: {} }] }), 'error');
	assert.equal(classifyResponse(read, 200, { type: 'data', nodes: [{ type: 'skip' }, { type: 'data', data: [] }] }), 'ok');
	assert.equal(classifyResponse(read, 401, { message: 'Tu sesión terminó.' }), 'error');
	assert.equal(classifyResponse(read, 0, null), 'error');
	assert.equal(classifyResponse(write, 200, { type: 'redirect', status: 303, location: '/odonto/turnos/x' }), 'ok');
	assert.equal(classifyResponse(write, 200, { type: 'success', status: 200 }), 'ok');
	assert.equal(classifyResponse(write, 200, { type: 'redirect', status: 303, location: '/login' }), 'error');
	assert.equal(classifyResponse(write, 200, { type: 'failure', status: 409 }), 'conflict');
	assert.equal(classifyResponse(write, 200, { type: 'failure', status: 400 }), 'error');
	assert.equal(classifyResponse(write, 500, { type: 'error' }), 'error');
});

test('percentiles and the acceptance thresholds of the plan are strict', () => {
	const samples = [
		...Array.from({ length: 99 }, (_, i) => ({ operation: 'agenda_day', category: 'read', durationMs: 100 + i, outcome: 'ok' })),
		{ operation: 'agenda_day', category: 'read', durationMs: 1999, outcome: 'ok' },
		...Array.from({ length: 100 }, (_, i) => ({ operation: 'add_clinical_entry', category: 'write', durationMs: 200 + i, outcome: 'ok' }))
	];
	const summary = summarize(samples);
	assert.deepEqual([summary.read.p50, summary.read.p95, summary.read.p99, summary.read.max], [149, 194, 198, 1999]);
	assert.equal(evaluateAcceptance(summary).passed, true);
	const slow = summarize(samples.map(sample => sample.category === 'read' && sample.durationMs > 190 ? { ...sample, durationMs: ACCEPTANCE.read.p95 } : sample));
	assert.equal(evaluateAcceptance(slow).readP95, false);
	const failing = summarize([...samples, { operation: 'agenda_day', category: 'read', durationMs: 5, outcome: 'error' },
		{ operation: 'agenda_day', category: 'read', durationMs: 5, outcome: 'error' }, { operation: 'agenda_day', category: 'read', durationMs: 5, outcome: 'error' }]);
	assert.equal(evaluateAcceptance(failing).errorRate, false);
	assert.equal(evaluateAcceptance(summarize([])).passed, false);
});

test('dates follow the practice zone and requests name the synthetic data of the practice', () => {
	const now = new Date('2026-10-20T02:30:00Z');
	assert.equal(localDate(now), '2026-10-19');
	assert.equal(localDate(now, 1), '2026-10-20');
	assert.equal(localDateTime(now), '2026-10-19T23:30');
	const data = practiceData(3);
	assert.equal(data.email, 'capacity-owner-03@example.test');
	// The app validates version and variant digits, as every id of gen_random_uuid() has them.
	const valid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
	assert.ok([data.business, ...data.professionals, ...data.services, data.patient(0), data.patient(5999), data.appointment(1)].every(id => valid.test(id)));
	assert.notEqual(data.patient(0), data.patient(1));
	const random = createRandom('plan');
	const create = planOperation(OPERATIONS.find(operation => operation.name === 'create_appointment'), data, random, { created: [] }, now);
	assert.match(create.prepare, /^\/odonto\/disponibilidad\/slots\?service_id=[0-9a-f-]{36}&professional_id=[0-9a-f-]{36}&from=\d{4}-\d{2}-\d{2}&to=/);
	const form = create.form({ date: '2026-10-25', time: '10:30' });
	assert.equal(form.patient_mode, 'existing');
	assert.ok(data.professionals.includes(form.professional_id) && data.services.includes(form.service_id));
	assert.match(form.idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	const cancel = OPERATIONS.find(operation => operation.name === 'cancel_appointment');
	assert.equal(planOperation(cancel, data, random, { created: [] }, now).substitute, 'appointment_detail');
	assert.equal(planOperation(cancel, data, random, { created: ['id-1'] }, now).path, '/odonto/turnos/id-1?/update_status');
});

test('a virtual user logs in once, keeps its session, records only the measured window and cancels what it created', async () => {
	const calls = [];
	const created = '11111111-2222-4333-8444-555555555555';
	const fake = async (url, init = {}) => {
		const path = url.replace('http://app.test', '');
		calls.push({ path, method: init.method ?? 'GET', cookie: init.headers?.cookie ?? '', body: init.body ? String(init.body) : '' });
		if (path === '/login?/login') return response(200, { type: 'redirect', status: 303, location: '/odonto' }, ['sb-access-token=token; Path=/', 'sb-module=odonto; Path=/']);
		if (path.startsWith('/odonto/disponibilidad/slots')) return response(200, { slots: [{ date: '2026-10-25', time: '10:30' }] });
		if (path === '/odonto/agenda?/create_appointment') return response(200, { type: 'redirect', status: 303, location: `/odonto/turnos/${created}?date=2026-10-25` });
		if (path.includes('?/')) return response(200, { type: 'success', status: 200 });
		return response(200, { type: 'data', nodes: [] });
	};
	const jar = await login('http://app.test', 'capacity-owner-01@example.test', 'secret', fake);
	assert.equal(new URLSearchParams(calls[0].body).get('email'), 'capacity-owner-01@example.test');
	let clock = 1_000;
	const realNow = Date.now;
	Date.now = () => clock;
	const records = [];
	try {
		await runVirtualUser({ origin: 'http://app.test', jar, data: practiceData(1), random: createRandom('vu-1'), measureFrom: 30_000, until: 400_000,
			record: sample => records.push(sample), fetchFn: fake, sleep: async ms => { clock += ms; } });
	} finally { Date.now = realNow; }
	const requests = calls.slice(1);
	assert.ok(requests.length > 50 && requests.every(call => call.cookie === 'sb-access-token=token; sb-module=odonto'));
	assert.ok(records.length > 0 && records.length < requests.length, 'requests before the measured window are not recorded');
	assert.ok(records.every(sample => sample.outcome === 'ok'));
	const creates = requests.filter(call => call.path === '/odonto/agenda?/create_appointment');
	const cancels = requests.filter(call => call.path === `/odonto/turnos/${created}?/update_status`);
	assert.ok(creates.length > 0 && cancels.length > 0 && cancels.length <= creates.length);
	assert.ok(cancels.every(call => new URLSearchParams(call.body).get('status') === 'cancelled'));
});

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PUBLIC_WRITE_INTERVAL_MS, nextPhone, pageData, publicBookingForm, runPublicAbuse, runPublicGenerator, syntheticName } from './capacity-load.mjs';
import { isValidPatientFullName } from '../../apps/web/src/lib/utils/patient-name.ts';

const kit = createRequire(createRequire(fileURLToPath(new URL('../../apps/web/package.json', import.meta.url))).resolve('@sveltejs/kit/package.json'));
const devalue = await import(pathToFileURL(kit.resolve('devalue')).href);
const dataResponse = state => response(200, { type: 'data', nodes: [{ type: 'skip' }, { type: 'data', data: JSON.parse(devalue.stringify({ state })), uses: {} }] });

test('public page data is decoded like the SvelteKit client does', () => {
	const body = { type: 'data', nodes: [{ type: 'data', data: JSON.parse(devalue.stringify({ layout: true })) }, { type: 'data', data: JSON.parse(devalue.stringify({ state: { slots: [{ starts_at: 'x' }] } })) }] };
	assert.deepEqual(pageData(body, devalue.unflatten), { state: { slots: [{ starts_at: 'x' }] } });
	assert.equal(pageData({ type: 'redirect', location: '/' }, devalue.unflatten), null);
	// A failed page never borrows the data of its layout.
	assert.equal(pageData({ type: 'data', nodes: [{ type: 'data', data: JSON.parse(devalue.stringify({ layout: true })) }, { type: 'error', status: 503 }] }, devalue.unflatten), null);
	assert.equal(nextPhone('+5491177000009'), '+5491177000010');
	// Public names admit no digits: every synthetic name passes the app's own rule.
	assert.equal(syntheticName('Reserva Pública', '+5491177000123'), 'Reserva Pública Abcd');
	let phone = '+5491177000000';
	for (let index = 0; index < 1000; index++, phone = nextPhone(phone))
		assert.ok(isValidPatientFullName(syntheticName('Reserva Pública', phone)) && isValidPatientFullName(syntheticName('Abuso Prueba', phone)), phone);
	assert.equal(isValidPatientFullName('Reserva pública 0001'), false);
});

test('the public generator reads both entry points and books once every four minutes with a different phone', async () => {
	const calls = [];
	const fake = async (url, init = {}) => {
		const path = url.replace('http://app.test', '');
		calls.push({ path, method: init.method ?? 'GET', body: init.body ? new URLSearchParams(String(init.body)) : null });
		if (path.includes('?/create_booking')) return response(200, { type: 'redirect', status: 303, location: '/turno/abc' });
		return dataResponse({ slots: [{ starts_at: '2026-10-25T13:30:00.000Z' }] });
	};
	let clock = 0;
	const realNow = Date.now;
	Date.now = () => clock;
	const records = [];
	let phone;
	try {
		phone = await runPublicGenerator({ origin: 'http://app.test', practices: 25, random: createRandom('public'), measureFrom: 0, until: 12 * 60_000,
			record: sample => records.push(sample), unflatten: devalue.unflatten, phone: '+5491177000000', fetchFn: fake, sleep: async ms => { clock += ms; } });
	} finally { Date.now = realNow; }
	const bookings = calls.filter(call => call.method === 'POST');
	assert.equal(bookings.length, Math.floor((12 * 60_000 - 30_000) / PUBLIC_WRITE_INTERVAL_MS) + 1);
	assert.equal(new Set(bookings.map(call => call.body.get('patient_phone'))).size, bookings.length);
	assert.ok(bookings.every(call => /^\/reservar\/[0-9a-f-]{36}\?\/create_booking$/.test(call.path) && call.body.get('slot_starts_at') === '2026-10-25T13:30:00.000Z'));
	assert.equal(phone, '+54911770000' + String(bookings.length).padStart(2, '0'));
	const reads = calls.filter(call => call.method === 'GET');
	assert.ok(reads.some(call => call.path.startsWith('/embed/v1/')) && reads.some(call => call.path.startsWith('/reservar/')));
	assert.ok(reads.length / 12 <= 41, 'public reads stay far below 120 per minute');
	assert.ok(records.every(sample => sample.outcome === 'ok'));
});

test('the abuse checks pass only when the system refuses both bursts', async () => {
	const realDate = global.Date;
	const run = async ({ readLimit, bookingRefusal }) => {
		let reads = 0;
		let bookings = 0;
		const fake = async (url, init = {}) => {
			if (url.includes('/embed/v1/')) {
				if (++reads <= readLimit) return dataResponse({ slots: [] });
				// The limit inside the failed layout node of a navigation, or as the HTTP status.
				return reads % 2 ? response(200, { type: 'data', nodes: [{ type: 'error', status: 429, error: { message: 'Esperá un minuto' } }, { type: 'skip' }] })
					: response(429, { message: 'Esperá un minuto' });
			}
			if (init.method === 'POST') {
				bookings++;
				return bookings > 1 && bookingRefusal
					? response(200, { type: 'failure', status: 400, data: devalue.stringify({ message: 'Se alcanzó el máximo de 3 intentos desde esta conexión en 10 minutos. Esperá unos minutos antes de volver a probar.' }) })
					: response(200, { type: 'redirect', status: 303, location: '/turno/abc' });
			}
			return dataResponse({ slots: [0, 1, 2, 3].map(index => ({ starts_at: `2026-10-25T1${index}:00:00.000Z` })) });
		};
		return runPublicAbuse({ origin: 'http://app.test', unflatten: devalue.unflatten, parse: devalue.parse, phone: '+5491177000100', fetchFn: fake, sleep: async () => {} });
	};
	global.Date = class extends realDate { getUTCSeconds() { return 0; } };
	try {
		const refused = await run({ readLimit: 120, bookingRefusal: true });
		assert.deepEqual([refused.reads.accepted, refused.reads.refused, refused.reads.firstRefusal, refused.passed], [120, 10, 121, true]);
		assert.equal((await run({ readLimit: 1000, bookingRefusal: true })).passed, false);
		assert.equal((await run({ readLimit: 120, bookingRefusal: false })).passed, false);
	} finally { global.Date = realDate; }
});

test('a public booking echoes the hidden fields the page sent, like the confirmation form', () => {
	const query = 'service_id=s-1&professional_id=p-1&date=2026-10-25';
	const page = { integration: { publicKey: 'k', revision: 3 }, priceQuote: { hash: 'q'.repeat(64) }, patientFields: { hash: 'f'.repeat(64) },
		bookingRequestId: '11111111-2222-4333-8444-555555555555' };
	assert.deepEqual(publicBookingForm(page, query, { starts_at: '2026-10-25T13:30:00.000Z' }, 'Reserva Pública Abcd', '+5491177000123'), {
		integration_revision: '3', modality: 'in_person', service_id: 's-1', booking_mode: 'individual', professional_id: 'p-1',
		slot_starts_at: '2026-10-25T13:30:00.000Z', price_quote_hash: 'q'.repeat(64), patient_schema_hash: 'f'.repeat(64),
		idempotency_key: '11111111-2222-4333-8444-555555555555', patient_name: 'Reserva Pública Abcd', patient_phone: '+5491177000123' });
	const plain = publicBookingForm({}, query, { starts_at: 'x' }, 'Reserva Pública Abcd', '+5491177000123');
	assert.equal('integration_revision' in plain || 'modality' in plain, false);
	assert.match(plain.idempotency_key, /^[0-9a-f-]{36}$/);
});

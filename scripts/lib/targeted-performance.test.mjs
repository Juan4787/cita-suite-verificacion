import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTargetedCpuProfile, assertTargetedRead, parseTargetedServerTiming, targetedCreatedId } from './targeted-performance.mjs';

const expected = { patientId: 'patient-own', businessId: 'practice-own', professionals: ['professional-own'] };
const patient = () => ({ type: 'data', nodes: [
	{ type: 'data', data: { activeBusiness: { business: { id: expected.businessId } } } },
	{ type: 'data', data: { patient: { id: expected.patientId } } }
] });
const timing = 'auth;dur=1, load;dur=2, db;dur=4, db_max;dur=3, db_http;desc="2"';

test('an HTTP200 failed layout cannot certify a patient read', () => {
	const body = patient();
	body.nodes.unshift({ type: 'error', status: 503 });
	assert.throws(() => assertTargetedRead('patient_detail', 200, body, expected, value => value));
	assert.doesNotThrow(() => assertTargetedRead('patient_detail', 200, patient(), expected, value => value));
});
test('successful data from a foreign patient or practice is rejected', () => {
	const body = patient();
	body.nodes[1].data.patient.id = 'foreign';
	assert.throws(() => assertTargetedRead('patient_detail', 200, body, expected, value => value));
	const other = patient();
	other.nodes[0].data.activeBusiness.business.id = 'foreign';
	assert.throws(() => assertTargetedRead('patient_detail', 200, other, expected, value => value));
});
test('empty or foreign availability does not certify usable owned slots', () => {
	assert.throws(() => assertTargetedRead('availability', 200, { slots: [] }, expected));
	assert.throws(() => assertTargetedRead('availability', 200, { slots: [{ professional_id: 'foreign' }] }, expected));
	assert.doesNotThrow(() => assertTargetedRead('availability', 200, { slots: [{ professional_id: expected.professionals[0] }] }, expected));
});
test('a login or foreign redirect cannot count as a created appointment', () => {
	for (const location of ['/login', 'https://foreign.test/odonto/turnos/1', '/odonto/agenda'])
		assert.throws(() => targetedCreatedId(200, { type: 'redirect', location }));
	const id = '01234567-89ab-4cde-8f01-23456789abcd';
	assert.equal(targetedCreatedId(200, { type: 'redirect', location: `/odonto/turnos/${id}?from_date=2026-10-28&created=1` }), id);
});
test('absent or duplicate timing is unknown, and overlapping durations are not subtracted as CPU', () => {
	for (const value of [null, '', timing + ', auth;dur=1', timing.replace('db;dur=4', 'db;dur=NaN')])
		assert.throws(() => parseTargetedServerTiming(value));
	assert.deepEqual(parseTargetedServerTiming(timing), { auth: 1, load: 2, db: 4, db_max: 3, db_http: 2, serverTotalMs: 3 });
});
test('empty, incomplete or unknown CPU samples cannot become a zero-cost profile', () => {
	for (const profile of [{ nodes: [], samples: [], timeDeltas: [] },
		{ nodes: [{ id: 1 }], samples: [1], timeDeltas: [] },
		{ nodes: [{ id: 1 }], samples: [2], timeDeltas: [1000] }])
		assert.throws(() => assertTargetedCpuProfile(profile));
	assert.doesNotThrow(() => assertTargetedCpuProfile({ nodes: [{ id: 1 }], samples: [1], timeDeltas: [1000] }));
});

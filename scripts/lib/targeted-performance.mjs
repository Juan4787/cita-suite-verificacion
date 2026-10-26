import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localDate, login, nodeError, practiceData } from './capacity-load.mjs';
import { summarizeCpuProfile } from './cpu-profile.mjs';

/** Hook wall times and overlapping HTTP intervals; none is labelled SQL or CPU. */
export function parseTargetedServerTiming(header) {
	const parts = String(header ?? '').split(',').map(value => value.trim());
	const result = {};
	for (const name of ['auth', 'load', 'db', 'db_max']) {
		const matches = parts.filter(value => value.startsWith(`${name};`));
		assert.equal(matches.length, 1, `Missing or duplicate ${name} timing`);
		const match = new RegExp(`^${name};dur=(\\d+(?:\\.\\d+)?)$`).exec(matches[0]);
		assert(match, `Invalid ${name} timing`);
		result[name] = Number(match[1]);
	}
	const trips = parts.filter(value => value.startsWith('db_http;'));
	assert.equal(trips.length, 1, 'Missing or duplicate HTTP count');
	const match = /^db_http;desc="(\d+)"$/.exec(trips[0]);
	assert(match, 'Invalid HTTP count');
	result.db_http = Number(match[1]);
	result.serverTotalMs = result.auth + result.load;
	return result;
}

export function assertTargetedRead(name, status, body, expected, unflatten) {
	assert.equal(status, 200);
	assert(body && typeof body === 'object' && !nodeError(body));
	if (name === 'availability' || name === 'creation_prepare') {
		assert(Array.isArray(body.slots) && body.slots.length > 0, 'No usable owned slot');
		assert(body.slots.every(slot => expected.professionals.includes(slot.professional_id)));
	} else {
		assert.equal(name, 'patient_detail');
		assert.equal(body.type, 'data');
		assert(Array.isArray(body.nodes));
		const nodes = body.nodes.filter(node => node?.type === 'data').map(node => unflatten(node.data));
		assert(nodes.some(node => node?.patient?.id === expected.patientId), 'Wrong patient');
		assert(nodes.some(node => node?.activeBusiness?.business?.id === expected.businessId), 'Wrong practice');
	}
}

export function targetedCreatedId(status, body) {
	assert.equal(status, 200);
	assert.equal(body?.type, 'redirect');
	const match = /^\/odonto\/turnos\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\?from_date=\d{4}-\d{2}-\d{2}&created=1$/.exec(body.location);
	assert(match, 'Creation did not return the canonical owned appointment route');
	return match[1];
}

export function assertTargetedCpuProfile(profile) {
	assert(Array.isArray(profile?.nodes) && profile.nodes.length > 0);
	assert(Array.isArray(profile.samples) && profile.samples.length > 0, 'No CPU samples');
	assert(Array.isArray(profile.timeDeltas) && profile.timeDeltas.length === profile.samples.length);
	assert(profile.timeDeltas.every(value => Number.isFinite(value) && value >= 0));
	const ids = new Set(profile.nodes.map(node => node.id));
	assert(profile.samples.every(id => ids.has(id)), 'CPU sample references an unknown node');
}

/** One sequential diagnostic in the already isolated workerd fixture, never production. */
export async function runTargetedPerformance({ origin, password, profiler, unflatten, saveProfile }) {
	assert(profiler, 'Targeted diagnostic requires the workerd inspector');
	const data = practiceData(1);
	const patientId = data.patient(1919);
	const expected = { patientId, businessId: data.business, professionals: data.professionals };
	const jar = await login(origin, data.email, password);
	let offset = 3;
	while ([0, 6].includes(new Date(localDate(new Date(), offset) + 'T12:00:00Z').getUTCDay())) offset++;
	const date = localDate(new Date(), offset);
	const records = [];
	const profiles = [];
	const createdIds = [];
	const availabilityPath = (professional, service = data.services[0]) => '/odonto/disponibilidad/slots?' +
		new URLSearchParams({ service_id: service, professional_id: professional, from: date, to: date });
	async function request(name, path, form) {
		const started = performance.now();
		const response = await fetch(origin + path, {
			method: form ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000),
			headers: { cookie: jar.header(), ...(form ? { origin, 'x-sveltekit-action': 'true',
				accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' } : {}) },
			...(form ? { body: new URLSearchParams(form) } : {})
		});
		jar.absorb(response);
		const body = await response.json();
		if (form) createdIds.push(targetedCreatedId(response.status, body));
		else assertTargetedRead(name, response.status, body, expected, unflatten);
		records.push({ name, ordinal: records.filter(row => row.name === name).length + 1,
			clientBodyMs: Math.round((performance.now() - started) * 1000) / 1000,
			timing: parseTargetedServerTiming(response.headers.get('server-timing')) });
		return body;
	}
	async function phase(name, action) {
		const before = records.length;
		await profiler.send('Profiler.start');
		await action();
		const { profile } = await profiler.send('Profiler.stop');
		assertTargetedCpuProfile(profile);
		const summary = summarizeCpuProfile(profile, { top: 60 });
		const result = { name, requests: records.length - before, ...summary,
			scope: 'Sampled workerd hot paths, including this phase first request; not hosted CPU allowance. Existing busyMs excludes idle/program/GC and is not total billed CPU.' };
		profiles.push(result);
		saveProfile(name, result);
	}
	await phase('availability', async () => {
		for (let index = 0; index < 8; index++)
			await request('availability', availabilityPath(data.professionals[index % 3], data.services[index % 5]));
	});
	await phase('patient_detail', async () => {
		for (let index = 0; index < 8; index++) await request('patient_detail', `/odonto/pacientes/${patientId}/__data.json`);
	});
	await phase('create_appointment', async () => {
		for (const professional of data.professionals) {
			const prepared = await request('creation_prepare', availabilityPath(professional));
			const slot = prepared.slots[0];
			await request('create_appointment', '/odonto/agenda?/create_appointment', {
				service_id: data.services[0], professional_id: professional, date: slot.date, time: slot.time,
				patient_mode: 'existing', patient_id: patientId, idempotency_key: randomUUID()
			});
		}
	});
	assert.equal(records.length, 22);
	assert.equal(new Set(createdIds).size, 3);
	return { records, profiles, createdIds, scope: 'Three target flows, one practice6000/12000,22requests. Diagnostic only; no capacity acceptance and no provider calls or live credentials.' };
}

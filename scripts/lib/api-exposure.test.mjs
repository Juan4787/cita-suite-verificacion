import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeAnonymousExposure } from './api-exposure.mjs';

const api = 'https://project.supabase.co';
const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
// A hosted API whose relations answer the anonymous key as `answers` says; the rest refuse it.
function hosted(answers = {}) {
	const reads = [];
	const request = async (url, init) => {
		const key = init.headers.apikey;
		if (url === `${api}/rest/v1/`)
			return key === 'service' ? json(200, { paths: { '/': {}, '/patients': {}, '/appointments': {}, '/rpc/book': {} } }) : json(401, { message: 'Invalid API key' });
		const relation = decodeURIComponent(new URL(url).pathname.slice('/rest/v1/'.length));
		reads.push({ relation, key });
		return answers[relation] ?? json(401, { code: '42501', message: 'permission denied' });
	};
	return { request, reads };
}

test('every relation the API exposes is read with the anonymous key and must be refused', async () => {
	const { request, reads } = hosted();
	assert.deepEqual(await probeAnonymousExposure({ api, serviceKey: 'service', anonKey: 'anon', request }), { relations: 2, exposed: [] });
	assert.deepEqual(reads, [{ relation: 'appointments', key: 'anon' }, { relation: 'patients', key: 'anon' }]);
});

test('a relation that answers rows, even none, or another error is reported as exposed', async () => {
	const { request } = hosted({ patients: json(200, []), appointments: json(401, { code: 'PGRST301' }) });
	assert.deepEqual((await probeAnonymousExposure({ api, serviceKey: 'service', anonKey: 'anon', request })).exposed, [
		{ relation: 'appointments', status: 401, code: 'PGRST301' }, { relation: 'patients', status: 200, code: null }]);
});

test('an API that lists nothing cannot pass as unexposed', async () => {
	const { request } = hosted();
	await assert.rejects(probeAnonymousExposure({ api, serviceKey: 'anon', anonKey: 'anon', request }), /listed no relations \(HTTP 401\)/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureRealtimeDiagnostic } from '../../apps/web/e2e/helpers/realtime-diagnostics.ts';

const api = 'http://127.0.0.1:54321';
const socket = 'ws://127.0.0.1:54321/realtime/v1/websocket?apikey=private-sentinel';
const message = (url, detail) => `WebSocket connection to '${url}' failed: ${detail}`;
const absent = 'Error during WebSocket handshake: Unexpected response code: 404';
const cancelled = 'WebSocket is closed before the connection is established.';

test('only the absent Realtime handshake of the owned fixture is classified', () => {
	assert.equal(fixtureRealtimeDiagnostic(message(socket, absent), 'disposable', api), 'fixture-realtime-unavailable');
});

test('navigation may cancel a connecting fixture socket without making a healthy-server claim', () => {
	const category = fixtureRealtimeDiagnostic(message(socket, cancelled), 'disposable', api);
	assert.equal(category, 'fixture-realtime-cancelled');
	assert.doesNotMatch(JSON.stringify(category), /private-sentinel|apikey|websocket/);
});

test('hosted, unrelated, unauthorized and malformed sockets remain unexpected failures', () => {
	for (const detail of [absent, cancelled]) {
		for (const environment of [undefined, 'staging', 'production'])
			assert.equal(fixtureRealtimeDiagnostic(message(socket, detail), environment, api), null);
		for (const url of [
			'ws://127.0.0.1:54322/realtime/v1/websocket',
			'ws://127.0.0.1:54321/another-websocket',
			'ws://localhost:54321/realtime/v1/websocket',
			'ws://remote.example.test/realtime/v1/websocket',
			'ws://user:secret@127.0.0.1:54321/realtime/v1/websocket',
			'wss://127.0.0.1:54321/realtime/v1/websocket'
		]) assert.equal(fixtureRealtimeDiagnostic(message(url, detail), 'disposable', api), null, url);
		for (const origin of [undefined, 'invalid', 'https://127.0.0.1:54321', 'http://remote.example.test:54321'])
			assert.equal(fixtureRealtimeDiagnostic(message(socket, detail), 'disposable', origin), null);
	}
	for (const code of [401, 403, 500])
		assert.equal(fixtureRealtimeDiagnostic(message(socket, absent.replace('404', String(code))), 'disposable', api), null);
	assert.equal(fixtureRealtimeDiagnostic(message(socket, 'net::ERR_CONNECTION_REFUSED'), 'disposable', api), null);
	assert.equal(fixtureRealtimeDiagnostic('An unrelated warning ' + cancelled, 'disposable', api), null);
});

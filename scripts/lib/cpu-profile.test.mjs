import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { connectInspector, summarizeCpuProfile } from './cpu-profile.mjs';

const frame = (functionName, url, lineNumber) => ({ functionName, url, lineNumber, columnNumber: 0, scriptId: '1' });

test('a profile becomes self and total time per function, without anything but names, files and lines', () => {
	// root → handle → format, root → handle and root → (idle).
	const profile = {
		nodes: [
			{ id: 1, callFrame: frame('(root)', '', -1), children: [2, 4] },
			{ id: 2, callFrame: frame('handle', 'file:///worker/_worker.js', 9), children: [3] },
			{ id: 3, callFrame: frame('format', 'file:///worker/chunks/calculate.js', 105), children: [] },
			{ id: 4, callFrame: frame('(idle)', '', -1), children: [] }
		],
		samples: [3, 3, 3, 2, 4, 4],
		timeDeltas: [0, 1000, 1000, 1000, 1000, 5000]
	};
	// As in DevTools, a sample lasts until the next one: format 3 ms, handle 1 ms, idle 5 ms.
	const summary = summarizeCpuProfile(profile);
	assert.deepEqual(summary.self.slice(0, 3), [
		{ name: '(idle) (native):0', ms: 5 }, { name: 'format calculate.js:106', ms: 3 }, { name: 'handle _worker.js:10', ms: 1 }]);
	assert.equal(summary.sampledMs, 9);
	assert.equal(summary.busyMs, 4);
	const handle = summary.total.find(entry => entry.name === 'handle _worker.js:10');
	assert.equal(handle.ms, 4);
	assert.doesNotMatch(JSON.stringify(summary), /worker\/chunks/);
});

test('recursion counts a function once per sample in its total time', () => {
	const profile = {
		nodes: [
			{ id: 1, callFrame: frame('(root)', '', -1), children: [2] },
			{ id: 2, callFrame: frame('walk', 'file:///w.js', 0), children: [3] },
			{ id: 3, callFrame: frame('walk', 'file:///w.js', 0), children: [] }
		],
		samples: [3, 3],
		timeDeltas: [0, 2000]
	};
	const summary = summarizeCpuProfile(profile);
	assert.equal(summary.total.find(entry => entry.name === 'walk w.js:1').ms, 2);
});

// Wrangler 4.86 InspectorProxyWorker requires Origin when User-Agent is set.
// Exercise a real Node WebSocket handshake against that boundary, without
// loading workerd, a browser, a database or any external service on this host.
async function guardedInspector(t) {
	const observed = [];
	const sockets = new Set();
	const server = createServer();
	server.on('connection', socket => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
	});
	server.on('upgrade', (request, socket) => {
		const origin = request.headers.origin ?? null;
		observed.push({ origin, userAgent: request.headers['user-agent'] ?? null });
		if (origin !== `http://${request.headers.host}`) {
			socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
			return;
		}
		const accept = createHash('sha1')
			.update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
			.digest('base64');
		socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
			`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(async () => {
		for (const socket of sockets) socket.destroy();
		await new Promise(resolve => server.close(resolve));
	});
	return { url: `ws://127.0.0.1:${server.address().port}/ws`, observed };
}

test('the inspector client supplies the loopback Origin required by Wrangler', { timeout: 3000 }, async t => {
	const { url, observed } = await guardedInspector(t);
	const client = await connectInspector(url);
	assert.equal(observed.length, 1);
	assert.equal(observed[0].origin, url.replace('ws:', 'http:').replace('/ws', ''));
	client.close();
});

test('a native handshake without Origin reproduces the refusal; the guard still rejects a foreign Origin', { timeout: 3000 }, async t => {
	const { url, observed } = await guardedInspector(t);
	for (const options of [undefined, { headers: { Origin: 'https://foreign.example.test' } }]) {
		const socket = new WebSocket(url, options);
		await new Promise(resolve => socket.addEventListener('error', resolve, { once: true }));
	}
	assert.deepEqual(observed, [
		{ origin: null, userAgent: 'node' },
		{ origin: 'https://foreign.example.test', userAgent: 'node' }
	]);
});

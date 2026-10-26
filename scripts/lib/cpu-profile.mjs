// CPU profiles of the app in workerd, taken through its inspector (the DevTools
// protocol) during a capacity load. Only function names, file names and lines
// survive: never arguments, values or request data.

/** Self and total time per function of a `Profiler.stop` profile, in milliseconds. */
export function summarizeCpuProfile(profile, { top = 40 } = {}) {
	const nodes = new Map(profile.nodes.map(node => [node.id, node]));
	const parent = new Map();
	for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
	const selfMicros = new Map();
	const samples = profile.samples ?? [];
	const deltas = profile.timeDeltas ?? [];
	// Each sample's time is the delta that follows it; the last one has none.
	for (let index = 0; index < samples.length; index++) {
		const micros = deltas[index + 1] ?? 0;
		selfMicros.set(samples[index], (selfMicros.get(samples[index]) ?? 0) + micros);
	}
	const label = node => {
		const frame = node.callFrame;
		const file = String(frame.url ?? '').split('/').pop() || '(native)';
		return `${frame.functionName || '(anonymous)'} ${file}:${frame.lineNumber + 1}`;
	};
	const self = new Map();
	const total = new Map();
	for (const [id, micros] of selfMicros) {
		const node = nodes.get(id);
		if (!node) continue;
		self.set(label(node), (self.get(label(node)) ?? 0) + micros);
		// Total time counts a function once per sample even when it recurses.
		const seen = new Set();
		for (let current = id; current !== undefined; current = parent.get(current)) {
			const name = label(nodes.get(current));
			if (seen.has(name)) continue;
			seen.add(name);
			total.set(name, (total.get(name) ?? 0) + micros);
		}
	}
	const ms = micros => Math.round(micros / 10) / 100;
	const sampledMicros = [...selfMicros.values()].reduce((sum, micros) => sum + micros, 0);
	const idle = [...self].filter(([name]) => /^\((idle|program|garbage collector)\)/.test(name)).reduce((sum, [, micros]) => sum + micros, 0);
	return {
		sampledMs: ms(sampledMicros),
		busyMs: ms(sampledMicros - idle),
		self: [...self].sort((a, b) => b[1] - a[1]).slice(0, top).map(([name, micros]) => ({ name, ms: ms(micros) })),
		total: [...total].sort((a, b) => b[1] - a[1]).slice(0, top).map(([name, micros]) => ({ name, ms: ms(micros) }))
	};
}

/** A minimal DevTools protocol client over the inspector's WebSocket. */
export async function connectInspector(url, WebSocketImpl = WebSocket) {
	// Node sends User-Agent but omits Origin by default; Wrangler's inspector
	// requires an allowed Origin for that handshake. Keep its origin guard intact.
	const endpoint = new URL(url);
	endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
	const socket = new WebSocketImpl(url, { headers: { Origin: endpoint.origin } });
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', () => reject(new Error('The inspector did not accept the connection.')), { once: true });
	});
	let next = 0;
	const pending = new Map();
	socket.addEventListener('message', event => {
		const message = JSON.parse(String(event.data));
		if (message.id === undefined || !pending.has(message.id)) return;
		const { resolve, reject } = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) reject(new Error(`Inspector ${message.error.code}: ${message.error.message}`));
		else resolve(message.result);
	});
	return {
		send: (method, params = {}) => new Promise((resolve, reject) => {
			const id = ++next;
			pending.set(id, { resolve, reject });
			socket.send(JSON.stringify({ id, method, params }));
		}),
		close: () => socket.close()
	};
}

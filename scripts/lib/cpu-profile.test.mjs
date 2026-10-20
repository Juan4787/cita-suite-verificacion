import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCpuProfile } from './cpu-profile.mjs';

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

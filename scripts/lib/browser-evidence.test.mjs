import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeBrowserText, safeBrowserUrl } from './browser-evidence.mjs';

test('browser diagnostics remove credentials, private booking paths and signed query parameters', () => {
	const url = safeBrowserUrl('https://user:password@example.test/turno/private-booking?token=private-token&v=unsafe');
	assert.equal(url, 'https://example.test/turno/[redacted]');
	assert.doesNotMatch(safeBrowserText('Bearer private-token eyJpayload.payload.signature https://storage.test/object?token=private-token'), /private-token|eyJpayload/);
});
test('local module version evidence survives without retaining arbitrary query values', () => {
	assert.equal(safeBrowserUrl('http://127.0.0.1:5177/node_modules/.vite/deps/module.js?v=1234abcd&token=private-token'),
		'http://127.0.0.1:5177/node_modules/.vite/deps/module.js?v=1234abcd');
	assert.equal(safeBrowserUrl('http://127.0.0.1:5177/src/page.ts?t=1790000000000&name=private'),
		'http://127.0.0.1:5177/src/page.ts?t=1790000000000');
	assert.equal(safeBrowserUrl('invalid'), '[invalid-url]');
});
test('diagnostic text has an explicit bound', () => {
	assert.equal(safeBrowserText('x'.repeat(5000)).length, 3000);
});

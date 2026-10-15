import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runVerificationProcess } from './verification-process.mjs';

test('the verifier propagates an actual critical assertion failure', async () => {
	const result = await runVerificationProcess(process.execPath,
		['--input-type=module', '-e', "import assert from 'node:assert/strict'; assert.equal('other-tenant', 'own-tenant');"],
		{ stdio: 'ignore' });
	assert.notEqual(result.status, 0);
});
test('an interrupted step cannot report success and no later step is started', async () => {
	const controller = new AbortController();
	const running = runVerificationProcess(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'],
		{ signal: controller.signal, stdio: 'ignore' });
	controller.abort();
	const result = await running;
	assert.notEqual(result.status, 0);
	assert.equal(result.interrupted, true);
	await assert.rejects(() => runVerificationProcess(process.execPath, ['-e', 'process.exit(0)'],
		{ signal: controller.signal, stdio: 'ignore' }), /interrupted before/);
});

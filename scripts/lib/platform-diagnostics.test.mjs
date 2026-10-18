import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePlatformDiagnostics, assertPlatformDiagnostics, assertRuntimeDiagnostics } from './platform-diagnostics.mjs';

test('preserves OOM/connection evidence without raw errors, logs or credentials', () => {
	const value = capturePlatformDiagnostics(args => {
		if (args[0] === 'inspect') return JSON.stringify({ state: { Running: false, OOMKilled: true, ExitCode: 137,
			Error: 'private password and token must not enter the receipt', StartedAt: 'start', FinishedAt: 'end' }, memoryBytes: 96e6, nanoCpus: 5e8 });
		if (args[0] === 'logs') return 'password=private-token: too many clients (SQLSTATE 53300)';
		if (args[0] === 'stats') return '{"Name":"synthetic-auth","MemUsage":"90MiB / 96MiB","MemPerc":"93.75%","CPUPerc":"0.1%","PIDs":"5"}';
		return '{"maximum":12,"deadlocks":0,"groups":[{"usename":"supabase_auth_admin","count":2}]}';
	}, { database: 'synthetic-db', auth: 'synthetic-auth' });
	assert.equal(value.containers[1].oomKilled, true);
	assert.equal(value.connections.maximum, 12);
	assert.equal(value.stats[0].memory, '90MiB / 96MiB');
	assert.deepEqual(value.authErrors, [{ sqlStates: ['53300'], categories: ['too many clients'] }]);
	assert.doesNotMatch(JSON.stringify(value), /password|private-token|must not/);
});

test('a functionally green run cannot conceal connection exhaustion or missing platform evidence', () => {
	const healthy = () => ({ containers: Array.from({ length: 4 }, () => ({ running: true, oomKilled: false })),
		connections: { maximum: 12, deadlocks: 0 }, authErrors: [] });
	assert.doesNotThrow(() => assertPlatformDiagnostics(healthy()));
	for (const change of [
		value => value.authErrors.push({ sqlStates: ['53300'], categories: ['remaining connection'] }),
		value => value.authErrors.push({ unavailable: true }),
		value => { value.containers[1].oomKilled = true; },
		value => { value.connections = { unavailable: true }; },
		value => { value.connections.deadlocks = 1; },
		value => { delete value.connections.deadlocks; }
	]) {
		const value = healthy(); change(value);
		assert.throws(() => assertPlatformDiagnostics(value), /infrastructure/);
	}
});
test('missing diagnostic sources are explicitly unavailable and never fabricated healthy', () => {
	const value = capturePlatformDiagnostics(() => { throw new Error('private connection string'); }, { database: 'synthetic-db', auth: 'synthetic-auth' });
	assert.equal(value.containers.every(container => container.unavailable), true);
	assert.deepEqual(value.connections, { unavailable: true });
	assert.deepEqual(value.authErrors, [{ unavailable: true }]);
	assert.doesNotMatch(JSON.stringify(value), /private connection/);
});

test('a browser pass cannot conceal the observed workerd SQLite crash or a V8 memory failure', () => {
 assert.doesNotThrow(() => assertRuntimeDiagnostics('Vite ready. Expected booking rejection: PRICE_QUOTE_CHANGED'));
 for (const log of [undefined, 'Fatal uncaught kj::Exception: SENTRY_DO database is locked: SQLITE_BUSY', 'JavaScript heap out of memory'])
  assert.throws(() => assertRuntimeDiagnostics(log), /fatal infrastructure/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePlatformDiagnostics } from './platform-diagnostics.mjs';

test('preserves OOM/connection evidence without raw errors, logs or credentials', () => {
	const value = capturePlatformDiagnostics(args => {
		if (args[0] === 'inspect') return JSON.stringify({ state: { Running: false, OOMKilled: true, ExitCode: 137,
			Error: 'private password and token must not enter the receipt', StartedAt: 'start', FinishedAt: 'end' }, memoryBytes: 96e6, nanoCpus: 5e8 });
		if (args[0] === 'logs') return 'password=private-token: too many clients (SQLSTATE 53300)';
		if (args[0] === 'stats') return '{"Name":"synthetic-auth","MemUsage":"90MiB / 96MiB","MemPerc":"93.75%","CPUPerc":"0.1%","PIDs":"5"}';
		return '{"maximum":12,"groups":[{"usename":"supabase_auth_admin","count":2}]}';
	}, { database: 'synthetic-db', auth: 'synthetic-auth' });
	assert.equal(value.containers[1].oomKilled, true);
	assert.equal(value.connections.maximum, 12);
	assert.equal(value.stats[0].memory, '90MiB / 96MiB');
	assert.deepEqual(value.authErrors, [{ sqlStates: ['53300'], categories: ['too many clients'] }]);
	assert.doesNotMatch(JSON.stringify(value), /password|private-token|must not/);
});
test('missing diagnostic sources are explicitly unavailable and never fabricated healthy', () => {
	const value = capturePlatformDiagnostics(() => { throw new Error('private connection string'); }, { database: 'synthetic-db', auth: 'synthetic-auth' });
	assert.equal(value.containers.every(container => container.unavailable), true);
	assert.deepEqual(value.connections, { unavailable: true });
	assert.deepEqual(value.authErrors, [{ unavailable: true }]);
	assert.doesNotMatch(JSON.stringify(value), /private connection/);
});

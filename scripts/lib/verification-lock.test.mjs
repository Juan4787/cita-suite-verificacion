import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireVerificationLock } from './verification-lock.mjs';

test('a separate runner is rejected while an inherited child can use the same lease', () => {
	const root = mkdtempSync(join(tmpdir(), 'cita-lease-test-'));
	const inherited = process.env.CITA_VERIFICATION_LEASE;
	delete process.env.CITA_VERIFICATION_LEASE;
	const lease = acquireVerificationLock(root);
	try {
		const code = `import {acquireVerificationLock} from ${JSON.stringify(import.meta.resolve('./verification-lock.mjs'))}; const lease=acquireVerificationLock(process.argv[1]); lease.release();`;
		const env = { ...process.env };
		delete env.CITA_VERIFICATION_LEASE;
		const rejected = spawnSync(process.execPath, ['--input-type=module', '-e', code, root], { env, encoding: 'utf8' });
		assert.notEqual(rejected.status, 0);
		assert.match(rejected.stderr, /Verification already owns/);
		const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, root], { encoding: 'utf8' });
		assert.equal(child.status, 0, child.stderr);
		assert.throws(() => acquireVerificationLock(join(root, '..')), /ENOENT|Invalid inherited/);
	} finally {
		lease.release();
		if (inherited !== undefined) process.env.CITA_VERIFICATION_LEASE = inherited;
		rmSync(root, { recursive: true });
	}
});

test('releasing the owner allows a later independent runner to acquire its lease', () => {
	const root = mkdtempSync(join(tmpdir(), 'cita-lease-release-'));
	const inherited = process.env.CITA_VERIFICATION_LEASE;
	delete process.env.CITA_VERIFICATION_LEASE;
	try {
		const first = acquireVerificationLock(root);
		first.release();
		const second = acquireVerificationLock(root);
		second.release();
	} finally {
		if (inherited !== undefined) process.env.CITA_VERIFICATION_LEASE = inherited;
		rmSync(root, { recursive: true });
	}
});

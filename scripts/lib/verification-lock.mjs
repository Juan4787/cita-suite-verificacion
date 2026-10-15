import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One lease per checkout, shared by child runners. A crashed owner's lease
// deliberately fails closed: recovery must first establish that its PID died.
export function acquireVerificationLock(root) {
	root = realpathSync(root);
	const fingerprint = createHash('sha256').update(root).digest('hex').slice(0, 20);
	const directory = join(tmpdir(), `cita-verification-${fingerprint}.lock`);
	const ownerFile = join(directory, 'owner.json');
	if (process.env.CITA_VERIFICATION_LEASE) {
		const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
		if (owner.token !== process.env.CITA_VERIFICATION_LEASE || owner.root !== root)
			throw new Error('Invalid inherited verification lease.');
		process.kill(owner.pid, 0);
		return { release() {} };
	}
	try {
		mkdirSync(directory, { mode: 0o700 });
	} catch (error) {
		if (error.code !== 'EEXIST') throw error;
		throw new Error(`Verification already owns ${directory}. If its process crashed, verify its PID before removing this lease.`);
	}
	const token = randomUUID();
	writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, root, token }), { mode: 0o600 });
	process.env.CITA_VERIFICATION_LEASE = token;
	return {
		release() {
			if (JSON.parse(readFileSync(ownerFile, 'utf8')).token !== token)
				throw new Error('Verification lease ownership changed.');
			rmSync(directory, { recursive: true });
			delete process.env.CITA_VERIFICATION_LEASE;
		}
	};
}

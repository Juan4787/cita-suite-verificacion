import { spawn } from 'node:child_process';

export async function runVerificationProcess(command, args, { signal, ...options }) {
	if (signal?.aborted) throw new Error('Verification interrupted before starting a step.');
	const child = spawn(command, args, { ...options, detached: true });
	let killTimer;
	function interrupt() {
		if (!child.pid) return;
		try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
		// Give resource-owning child runners time to finish their own cleanup.
		killTimer = setTimeout(() => {
			try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
		}, 15_000);
		killTimer.unref();
	}
	signal?.addEventListener('abort', interrupt, { once: true });
	try {
		return await new Promise(resolve => {
			child.once('error', error => resolve({ status: null, signal: null, error }));
			child.once('close', (status, childSignal) => resolve({ status, signal: childSignal, interrupted: signal?.aborted === true }));
		});
	} finally {
		clearTimeout(killTimer);
		signal?.removeEventListener('abort', interrupt);
	}
}

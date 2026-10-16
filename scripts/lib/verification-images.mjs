import { spawnSync } from 'node:child_process';

export const verificationImages = [
	['postgres:17.6.1.166', 'supabase/postgres', 'b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86'],
	['storage-api:v1.70.3', 'supabase/storage-api', '528ec49c3c32561908b07ee91bced7f8456f3b688164e341eaa422441767a0bd'],
	['postgrest:v16.1', 'postgrest/postgrest', '5922bde07147b82b1c9d8f749e48c1e5b99ebb233f3888bb7ab65f07cf4ac82d'],
	['gotrue:v2.196.0', 'supabase/gotrue', 'c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232'],
	['postgres-meta:v0.98.0', 'supabase/postgres-meta', 'cef71ba901751dcc242cc685cf13786935ea8926820fb342f23bb0fbef77de5a']
].map(([tag, repository, digest]) => ({
	image: 'public.ecr.aws/supabase/' + tag,
	source: `docker.io/${repository}@sha256:${digest}`,
	digest: 'sha256:' + digest
}));

// Only registry/transport failures are retryable. Missing images, bad tags and
// denied credentials must remain visible instead of consuming the retry budget.
export function transientImageFailure(message) {
	return /toomanyrequests|rate exceeded|too many requests|(?:status|code)[^\n]*\b(?:429|50[0234])\b|TLS handshake timeout|i\/o timeout|connection reset|unexpected EOF|temporary failure in name resolution/i.test(message);
}

export async function pullVerificationImage(image, {
	pull = (name) => spawnSync('docker', ['pull', name], { encoding: 'utf8', timeout: 180_000, maxBuffer: 2 * 1024 ** 2 }),
	sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
	onAttempt = () => {},
	delays = [15_000, 30_000, 60_000, 120_000]
} = {}) {
	for (let attempt = 0; ; attempt++) {
		const result = pull(image);
		const output = `${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`.trim();
		const ok = result.status === 0 && !result.error;
		const retry = !ok && attempt < delays.length && transientImageFailure(output);
		onAttempt({ image, attempt: attempt + 1, ok, retry,
			digest: ok ? output.match(/Digest: (sha256:[a-f0-9]{64})/)?.[1] ?? null : null,
			error: ok ? null : output.slice(-4096) });
		if (ok) return;
		if (!retry) throw new Error(`Disposable image preparation failed: ${image}; ${output.slice(-1024)}`);
		await sleep(delays[attempt]);
	}
}

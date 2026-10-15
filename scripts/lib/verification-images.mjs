import { spawnSync } from 'node:child_process';

export const verificationImages = [
	'public.ecr.aws/supabase/postgres:17.6.1.166',
	'public.ecr.aws/supabase/storage-api:v1.70.3',
	'public.ecr.aws/supabase/postgrest:v16.1',
	'public.ecr.aws/supabase/gotrue:v2.196.0'
];

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

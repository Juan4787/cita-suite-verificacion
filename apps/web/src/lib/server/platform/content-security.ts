const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Adds the Supabase project this deployment uses to the policy SvelteKit rendered: its origin for
 * the API, Storage uploads and images, and its socket for Realtime. Only that project, never every
 * Supabase project. HTTPS, or HTTP on loopback for the disposable verification platform; any other
 * value leaves the policy unchanged, which blocks the connection rather than widening it.
 */
export function withSupabaseOrigin(policy: string, configuredUrl: string | undefined): string {
	let url: URL;
	try {
		url = new URL(configuredUrl ?? '');
	} catch {
		return policy;
	}
	const secure = url.protocol === 'https:';
	if (!policy || (!secure && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) ||
		url.username || url.password || url.pathname !== '/' || url.search || url.hash)
		return policy;
	const sources: Record<string, string[]> = {
		'connect-src': [url.origin, `${secure ? 'wss' : 'ws'}://${url.host}`],
		'img-src': [url.origin]
	};
	return policy.split(';').map((directive) => directive.trim()).filter(Boolean).map((directive) => {
		const extra = sources[directive.split(/\s+/)[0]];
		return extra ? `${directive} ${extra.join(' ')}` : directive;
	}).join('; ');
}

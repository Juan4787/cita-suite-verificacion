import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { PUBLIC_SITE_URL_FALLBACK } from '$lib/constants';

const configuredHost = (raw: unknown): string | null => {
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const url = new URL(raw.trim());
		return url.protocol === 'https:' ? url.hostname.toLowerCase() : null;
	} catch {
		return null;
	}
};

const allowedHosts = () => {
	const hosts = new Set<string>();
	const fallback = configuredHost(PUBLIC_SITE_URL_FALLBACK);
	const publicSite = configuredHost((publicEnv as Record<string, unknown>).PUBLIC_SITE_URL);
	const privateSite = configuredHost((env as Record<string, unknown>).PUBLIC_SITE_URL);
	const supabase = configuredHost((env as Record<string, unknown>).ODONTO_SUPABASE_URL);
	for (const host of [fallback, publicSite, privateSite, supabase]) {
		if (host) hosts.add(host);
	}
	return hosts;
};

/**
 * Public logos/avatars are rendered by browsers, not fetched by the Worker.
 * Keep their origins aligned with CSP so a saved value can never produce a
 * predictable broken image or an unsolicited third-party request from a
 * clinical booking page. Relative paths are self-origin resources.
 */
export const isAllowedPublicImageUrl = (raw: unknown): raw is string => {
	if (typeof raw !== 'string') return false;
	const value = raw.trim();
	if (!value || value.length > 2048) return false;
	if (value.startsWith('/') && !value.startsWith('//')) return true;
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			!url.username &&
			!url.password &&
			(!url.port || url.port === '443') &&
			allowedHosts().has(url.hostname.toLowerCase())
		);
	} catch {
		return false;
	}
};

export const sanitizePublicImageUrl = (raw: unknown): string | null =>
	isAllowedPublicImageUrl(raw) ? String(raw).trim() : null;

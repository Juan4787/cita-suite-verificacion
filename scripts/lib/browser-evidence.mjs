/** @param {string} value */
export function safeBrowserUrl(value) {
	try {
		const url = new URL(value);
		const version = new URLSearchParams();
		if (['127.0.0.1', 'localhost'].includes(url.hostname) && /\/(?:node_modules|src|@id)\//.test(url.pathname)) {
			for (const key of ['v', 't', 'import']) {
				const item = url.searchParams.get(key);
				const valid = item !== null && (key === 'v' ? /^[a-f0-9]{8,64}$/i.test(item) : key === 't' ? /^\d{10,16}$/.test(item) : item === '');
				if (valid) version.set(key, item);
			}
		}
		return url.origin + url.pathname.replace(/\/turno\/[^/]+/, '/turno/[redacted]') + (version.size ? '?' + version : '');
	} catch { return '[invalid-url]'; }
}

/** @param {string} value */
export const safeBrowserText = value => value
	.replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
	.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
	.replace(/https?:\/\/[^\s"'<>]+/g, safeBrowserUrl)
	.slice(0, 3000);

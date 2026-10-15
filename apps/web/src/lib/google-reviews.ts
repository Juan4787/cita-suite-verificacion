export const GOOGLE_REVIEW_DEFAULT_TITLE =
	'✨ Esperamos que hayas tenido una buena experiencia con nosotros.';
export const GOOGLE_REVIEW_DEFAULT_BODY =
	'Si querés, compartí tu opinión en Google. Puede ayudar a otros que estén buscando dónde atenderse.';
export const GOOGLE_REVIEW_DEFAULT_ACTION_LABEL = 'Compartir mi opinión';

export const GOOGLE_REVIEW_TITLE_MAX_LENGTH = 120;
export const GOOGLE_REVIEW_BODY_MAX_LENGTH = 500;
export const GOOGLE_REVIEW_ACTION_MAX_LENGTH = 60;
export const GOOGLE_REVIEW_URL_MAX_LENGTH = 2048;

export const GOOGLE_REVIEW_DEFAULT_MESSAGE = {
	title: GOOGLE_REVIEW_DEFAULT_TITLE,
	body: GOOGLE_REVIEW_DEFAULT_BODY,
	actionLabel: GOOGLE_REVIEW_DEFAULT_ACTION_LABEL
} as const;

const isGoogleDomain = (hostname: string) =>
	/^google\.(?:com|com\.[a-z]{2}|[a-z]{2,3})$/.test(hostname) ||
	/^(?:maps|search)\.google\.(?:com|com\.[a-z]{2}|[a-z]{2,3})$/.test(hostname);

/**
 * Acepta solamente destinos de reseña controlados por Google. La ruta interna
 * `/r/{token}` redirige a este valor, por lo que una URL HTTPS genérica convertiría
 * el producto en un redireccionador abierto.
 */
export const isValidGoogleReviewUrl = (raw: string): boolean => {
	const value = raw.trim();
	if (!value || value.length > GOOGLE_REVIEW_URL_MAX_LENGTH) return false;

	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			(url.port && url.port !== '443') ||
			url.hash
		) {
			return false;
		}

		if (hostname === 'g.page') {
			return /^\/r\/[^/]+\/review\/?$/.test(url.pathname);
		}
		if (hostname === 'maps.app.goo.gl') {
			return /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
		}
		if (hostname === 'goo.gl') {
			return /^\/maps\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
		}
		if (!isGoogleDomain(hostname)) return false;

		return (
			url.pathname === '/local/writereview' ||
			url.pathname === '/local/writereview/' ||
			url.pathname === '/maps' ||
			url.pathname.startsWith('/maps/')
		);
	} catch {
		return false;
	}
};

export const trimGoogleReviewMessage = (input: {
	title: string;
	body: string;
	actionLabel: string;
}) => ({
	title: input.title.trim(),
	body: input.body.trim(),
	actionLabel: input.actionLabel.trim()
});

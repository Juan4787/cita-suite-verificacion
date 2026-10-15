import crypto from 'crypto';

// Núcleo compartido de verificación HMAC de los webhooks públicos (WhatsApp y
// Mercado Pago). Cualquier endurecimiento (normalización, comparación binaria)
// se hace acá una sola vez.
export const hmacSha256Hex = (secret: string, message: string): string =>
	crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');

export const hmacSha256HexMatches = (
	secret: string,
	message: string,
	providedHex: string
): boolean => {
	const expected = hmacSha256Hex(secret, message);
	const provided = providedHex.trim().toLowerCase();
	if (expected.length !== provided.length) return false;
	try {
		return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
	} catch {
		return false;
	}
};

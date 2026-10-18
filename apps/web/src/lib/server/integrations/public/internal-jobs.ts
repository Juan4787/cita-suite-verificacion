import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import crypto from 'crypto';

// Comparación en tiempo constante: evita filtrar el secret por diferencias de
// latencia byte a byte (mismo estándar que la verificación HMAC del webhook).
const secretMatches = (candidate: string, secret: string): boolean => {
	const a = Buffer.from(candidate);
	const b = Buffer.from(secret);
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
};

export const assertInternalJobRequest = (request: Request) => {
	const secret = env.INTERNAL_JOB_SECRET?.trim();
	if (!secret) {
		return json({ message: 'Falta configurar INTERNAL_JOB_SECRET.' }, { status: 503 });
	}
	const authorization = request.headers.get('authorization') ?? '';
	const headerSecret = request.headers.get('x-job-secret') ?? '';
	const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
	if (!secretMatches(bearer, secret) && !secretMatches(headerSecret, secret)) {
		return json({ message: 'No autorizado.' }, { status: 401 });
	}
	return null;
};

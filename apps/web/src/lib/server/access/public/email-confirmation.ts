import { dev } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import { EMAIL_CONFIRMATION_PATH, validConfirmationEmail } from '$lib/access/email-confirmation';
import { hmacSha256Hex, hmacSha256HexMatches } from '$lib/server/platform/hmac';

// Like password recovery, use the public application origin. Alternate app
// domains need not have every confirmation path registered with the provider.
export const emailConfirmationRedirect = (requestUrl: string) => {
	try {
		const configured = new URL(publicEnv.PUBLIC_SITE_URL?.trim() ?? '');
		if (configured.protocol === 'https:' || (configured.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(configured.hostname))) {
			return new URL(EMAIL_CONFIRMATION_PATH, configured).toString();
		}
	} catch { /* An unset local origin falls back to the current application. */ }
	return new URL(EMAIL_CONFIRMATION_PATH, requestUrl).toString();
};

export const EMAIL_CONFIRMATION_COOKIE = 'cita-email-confirmation';
export type EmailConfirmationContext = { email: string; status: 'pending' | 'confirmed'; resendAfter: number; expiresAt: number };

// This is a short-lived display context, not an identity or a session. It grants
// no access; only password/Google authentication may create the app's auth cookies.
export const readEmailConfirmation = (cookies: Cookies, now = Date.now()): EmailConfirmationContext | null => {
	try {
		const value: unknown = JSON.parse(cookies.get(EMAIL_CONFIRMATION_COOKIE) ?? 'null');
		if (!value || typeof value !== 'object') return null;
		const c = value as Record<string, unknown>;
		if (typeof c.email !== 'string' || !validConfirmationEmail(c.email) || !['pending', 'confirmed'].includes(String(c.status))
			|| typeof c.resendAfter !== 'number' || !Number.isFinite(c.resendAfter)
			|| typeof c.expiresAt !== 'number' || !Number.isFinite(c.expiresAt) || c.expiresAt <= now) return null;
		const context: EmailConfirmationContext = { email: c.email, status: c.status as 'pending' | 'confirmed', resendAfter: c.resendAfter, expiresAt: c.expiresAt };
		if (context.status === 'confirmed' && (!env.INTERNAL_JOB_SECRET || typeof c.proof !== 'string' || !hmacSha256HexMatches(env.INTERNAL_JOB_SECRET, 'email-confirmation:v1:' + JSON.stringify(context), c.proof))) return null;
		return context;
	} catch { return null; }
};

export const writeEmailConfirmation = (cookies: Cookies, email: string, status: 'pending' | 'confirmed', sent = false, now = Date.now()) => {
	if (!validConfirmationEmail(email)) throw new Error('INVALID_CONFIRMATION_EMAIL');
	const maxAge = status === 'confirmed' ? 10 * 60 : 60 * 60;
	const context: EmailConfirmationContext = { email, status, resendAfter: sent ? now + 60_000 : 0, expiresAt: now + maxAge * 1000 };
	let proof: string | undefined;
	if (status === 'confirmed') {
		if (!env.INTERNAL_JOB_SECRET || env.INTERNAL_JOB_SECRET.length < 32) throw new Error('CONFIRMATION_CONTEXT_UNAVAILABLE');
		proof = hmacSha256Hex(env.INTERNAL_JOB_SECRET, 'email-confirmation:v1:' + JSON.stringify(context));
	}
	cookies.set(EMAIL_CONFIRMATION_COOKIE, JSON.stringify({ ...context, ...(proof ? { proof } : {}) }), { path: '/', httpOnly: true, secure: !dev, sameSite: 'lax', maxAge });
};

export const readConfirmationForm = async (request: Request): Promise<URLSearchParams> => {
	if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new Error('INVALID_CONFIRMATION_FORM');
	const reader = request.body?.getReader();
	if (!reader) return new URLSearchParams();
	const chunks: Uint8Array[] = []; let size = 0;
	for (;;) {
		const { done, value } = await reader.read(); if (done) break;
		size += value.byteLength;
		if (size > 16_384) { await reader.cancel(); throw new Error('CONFIRMATION_FORM_TOO_LARGE'); }
		chunks.push(value);
	}
	const bytes = new Uint8Array(size); let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return new URLSearchParams(new TextDecoder().decode(bytes));
};

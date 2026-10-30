import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { validConfirmationEmail } from '$lib/access/email-confirmation';

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
		return { email: c.email, status: c.status as 'pending' | 'confirmed', resendAfter: c.resendAfter, expiresAt: c.expiresAt };
	} catch { return null; }
};

export const writeEmailConfirmation = (cookies: Cookies, email: string, status: 'pending' | 'confirmed', sent = false, now = Date.now()) => {
	if (!validConfirmationEmail(email)) throw new Error('INVALID_CONFIRMATION_EMAIL');
	const maxAge = status === 'confirmed' ? 10 * 60 : 60 * 60;
	const context: EmailConfirmationContext = { email, status, resendAfter: sent ? now + 60_000 : 0, expiresAt: now + maxAge * 1000 };
	cookies.set(EMAIL_CONFIRMATION_COOKIE, JSON.stringify(context), { path: '/', httpOnly: true, secure: !dev, sameSite: 'lax', maxAge });
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

import { readFileSync } from 'node:fs';
import { createFixtureClient } from './fixture-db';

// Owned, internal SMTP capture only. Never expose messages or URLs in logs.
export function ownedEmailFixture() {
	const origin = process.env.ODONTO_SUPABASE_URL;
	const site = process.env.PUBLIC_SITE_URL;
	const key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	const anon = process.env.ODONTO_SUPABASE_ANON_KEY;
	const businessId = process.env.CITA_SUITE_TEST_BUSINESS_ID;
	const mail = process.env.CITA_AUTH_MAILBOX_ORIGIN;
	const runtimePath = process.env.E2E_LOCAL_BOOKING_FIXTURE_PATH;
	if (process.env.CITA_E2E_ENVIRONMENT !== 'disposable' || !origin || !site || !key || !anon || !businessId || !mail || !runtimePath)
		throw new Error('Email confirmation requires the complete owned disposable fixture.');
	const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
	if (new URL(origin).hostname !== '127.0.0.1' || new URL(site).hostname !== '127.0.0.1' || runtime.mailOrigin !== mail || !runtime.emailConfirmationRequired || !runtime.mailContainer)
		throw new Error('Email confirmation fixture ownership is invalid.');
	return { origin, site, businessId, mail, admin: createFixtureClient(origin, key), auth: createFixtureClient(origin, anon) };
}

type MailSummary = { ID: string; To: { Address: string }[] };
export async function capturedSignupMessages(mail: string, email: string): Promise<MailSummary[]> {
	const response = await fetch(mail + '/api/v1/messages?limit=50', { signal: AbortSignal.timeout(5000) });
	if (!response.ok) throw new Error('Owned SMTP capture is unavailable.');
	const data = await response.json() as { messages: MailSummary[] };
	return data.messages.filter(message => message.To.some(to => to.Address.toLowerCase() === email));
}

export async function capturedSignupUrl(mail: string, email: string, origin: string, site: string, allowedReturns: string[] = [site + '/confirmar-correo']) {
	if (allowedReturns.some(value => { const url = new URL(value); return url.origin !== site || !['/', '/confirmar-correo'].includes(url.pathname) || url.search || url.hash; })) throw new Error('Owned confirmation return allowlist is invalid.');
	const summaries = await capturedSignupMessages(mail, email);
	if (!summaries.length) throw new Error('Owned confirmation email was not captured.');
	const response = await fetch(mail + '/api/v1/message/' + encodeURIComponent(summaries[0].ID));
	if (!response.ok) throw new Error('Owned confirmation email could not be read.');
	const message = await response.json() as { HTML: string };
	const links = [...message.HTML.matchAll(/href=["']([^"']+)["']/g)].map(match => match[1].replaceAll('&amp;', '&'));
	const link = links.find(value => { try { const url = new URL(value); return url.origin === origin && url.pathname === '/auth/v1/verify'; } catch { return false; } });
	if (!link) throw new Error('Owned email does not contain its Auth confirmation link.');
	const url = new URL(link);
	if (url.searchParams.get('type') !== 'signup' || !allowedReturns.includes(url.searchParams.get('redirect_to') ?? ''))
		throw new Error('Owned confirmation link has an unexpected return destination.');
	return link;
}


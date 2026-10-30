import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createFixtureClient, write } from './helpers/fixture-db';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { alignTaskForCapture } from './helpers/task-capture';
import { observeRenderHealth } from './helpers/render-health';
import { signInWithPassword } from './helpers/shared-auth';

// The captured SMTP messages and Auth links stay in memory. Never retain them
// in traces, videos, automatic failure screenshots or assertion diagnostics.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

function fixture() {
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

async function signup(page: Page, email: string, password: string) {
	await page.goto('/login?registro=1');
	await page.getByLabel('Correo electrónico').fill(email);
	await page.locator('#password').fill(password);
	await page.getByLabel('Confirmar contraseña').fill(password);
	await page.getByRole('checkbox').check();
	await page.locator('form').first().getByRole('button', { name: 'Crear cuenta', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Revisá tu correo' })).toBeVisible();
	expect(new URL(page.url()).pathname).toBe('/confirmar-correo');
}

type MailSummary = { ID: string; To: { Address: string }[] };
async function messages(mail: string, email: string): Promise<MailSummary[]> {
	const response = await fetch(mail + '/api/v1/messages?limit=50', { signal: AbortSignal.timeout(5000) });
	if (!response.ok) throw new Error('Owned SMTP capture is unavailable.');
	const data = await response.json() as { messages: MailSummary[] };
	return data.messages.filter(message => message.To.some(to => to.Address.toLowerCase() === email));
}

async function confirmationUrl(mail: string, email: string, origin: string, site: string) {
	const summaries = await messages(mail, email);
	if (!summaries.length) throw new Error('Owned confirmation email was not captured.');
	const response = await fetch(mail + '/api/v1/message/' + encodeURIComponent(summaries[0].ID));
	if (!response.ok) throw new Error('Owned confirmation email could not be read.');
	const message = await response.json() as { HTML: string };
	const links = [...message.HTML.matchAll(/href=["']([^"']+)["']/g)].map(match => match[1].replaceAll('&amp;', '&'));
	const link = links.find(value => { try { const url = new URL(value); return url.origin === origin && url.pathname === '/auth/v1/verify'; } catch { return false; } });
	if (!link) throw new Error('Owned email does not contain its Auth confirmation link.');
	const url = new URL(link);
	if (url.searchParams.get('type') !== 'signup' || url.searchParams.get('redirect_to') !== site + '/confirmar-correo')
		throw new Error('Owned confirmation link has an unexpected return destination.');
	return link;
}

async function follow(page: Page, link: string) {
	try { await page.goto(link); } catch { throw new Error('Could not follow the owned confirmation email link.'); }
}
async function noAppSession(page: Page) {
	expect((await page.context().cookies()).some(cookie => ['sb-access-token', 'sb-refresh-token'].includes(cookie.name))).toBe(false);
}

test('email confirmation @candidate-behavior: signup, SMTP resend, new browser, password login and reused link', async ({ page, browser }, info) => {
	test.setTimeout(180_000);
	const f = fixture();
	const email = `confirmation-${randomUUID()}@example.test`, password = `Synthetic!${randomUUID()}`;
	let userId: string | undefined;
	const health = await observeRenderHealth(page);
	const other = await browser.newContext({ baseURL: f.site });
	const confirmationPage = await other.newPage();
	const confirmationHealth = await observeRenderHealth(confirmationPage);
	try {
		await signup(page, email, password);
		await expect(page.getByRole('alert')).toHaveCount(0);
		await expect(page.getByText(email, { exact: true })).toBeVisible();
		await noAppSession(page);
		const blocked = await f.auth.auth.signInWithPassword({ email, password });
		expect(blocked.error?.code).toBe('email_not_confirmed');
		expect(blocked.data.session === null).toBe(true);
		await expect.poll(async () => (await messages(f.mail, email)).length, { timeout: 15_000 }).toBe(1);
		const issues: LayoutIssue[] = [];
		for (const width of [320, 390, 768, 1280, 1600]) {
			await page.setViewportSize({ width, height: 900 });
			issues.push(...await layoutIssues(page, 'button, a, input:not([type=hidden])', 'body'));
			await alignTaskForCapture(page.getByRole('heading', { name: 'Revisá tu correo' }));
			await page.screenshot({ path: info.outputPath(`confirmation-pending-${width}.jpg`), type: 'jpeg', quality: 65, fullPage: true });
		}
		expect(issues).toEqual([]);
		await expect(page.getByRole('button', { name: 'Reenviar correo', exact: true })).toBeEnabled({ timeout: 70_000 });
		await page.getByRole('button', { name: 'Reenviar correo', exact: true }).click();
		await expect(page.getByText('Si tu cuenta necesita confirmación, vas a recibir un nuevo enlace. Revisá también el correo no deseado.')).toBeVisible();
		await expect(page.getByRole('alert')).toHaveCount(0);
		await expect.poll(async () => (await messages(f.mail, email)).length, { timeout: 15_000 }).toBe(2);
		const link = await confirmationUrl(f.mail, email, f.origin, f.site);
		await follow(confirmationPage, link);
		await expect(confirmationPage.getByRole('heading', { name: 'Correo confirmado', exact: true })).toBeVisible();
		expect(new URL(confirmationPage.url()).hash.length).toBe(0);
		await noAppSession(confirmationPage);
		const confirmed = await f.auth.auth.signInWithPassword({ email, password });
		if (confirmed.error || !confirmed.data.user?.email_confirmed_at) throw new Error('Owned confirmed account cannot sign in.');
		userId = confirmed.data.user.id;
		await write(f.admin.from('business_users').insert({ business_id: f.businessId, user_id: userId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() }));
		await signInWithPassword(page, email, password);
		await expect(page.getByRole('button', { name: '+ Nuevo turno', exact: true })).toBeVisible();
		await follow(confirmationPage, link);
		await expect(confirmationPage.getByRole('heading', { name: 'Abrí el enlace más reciente' })).toBeVisible();
		await expect(confirmationPage.getByRole('heading', { name: 'Correo confirmado', exact: true })).toHaveCount(0);
		expect(new URL(confirmationPage.url()).hash.length).toBe(0);
		await noAppSession(confirmationPage);
		await health.assertAndAttach(info, 'email-confirmation-signup-health');
		await confirmationHealth.assertAndAttach(info, 'email-confirmation-link-health');
		await info.attach('email-confirmation-proof', { body: JSON.stringify({ realDisposableAuth: true, emailConfirmationRequired: true, unconfirmedLoginRejected: true, isolatedSmtpMessages: 2, isolatedEmailUrlFollowed: true, externalMailboxDelivery: false, newBrowserConfirmation: true, manualPasswordLogin: true, reusedLinkNeutral: true, noAutomaticAppSession: true, widths: [320, 390, 768, 1280, 1600] }), contentType: 'application/json' });
	} finally {
		await other.close();
		if (!userId) {
			const listed = await f.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
			if (listed.error) throw new Error('Owned signup cleanup lookup failed.');
			userId = listed.data.users.find(user => user.email === email)?.id;
		}
		if (userId) {
			await write(f.admin.from('business_users').delete().eq('business_id', f.businessId).eq('user_id', userId));
			await write(f.admin.auth.admin.deleteUser(userId));
		}
	}
});

test('email confirmation @candidate-behavior: invalid token overrides previous confirmed context', async ({ page }, info) => {
	const f = fixture();
	const email = `confirmation-invalid-${randomUUID()}@example.test`, password = `Synthetic!${randomUUID()}`;
	const created = await f.admin.auth.admin.createUser({ email, password, email_confirm: true });
	if (created.error || !created.data.user) throw new Error('Owned confirmation user was not created.');
	const health = await observeRenderHealth(page, failure => failure.method === 'POST' && failure.path === '/confirmar-correo' && failure.status === 410, 1);
	try {
		const login = await f.auth.auth.signInWithPassword({ email, password });
		if (login.error || !login.data.session) throw new Error('Owned confirmation token is unavailable.');
		await follow(page, f.site + '/confirmar-correo#' + new URLSearchParams({ access_token: login.data.session.access_token, type: 'signup' }));
		await expect(page.getByRole('heading', { name: 'Correo confirmado', exact: true })).toBeVisible();
		await follow(page, f.site + '/confirmar-correo#access_token=a.b.c&type=signup');
		await expect(page.getByRole('heading', { name: 'Abrí el enlace más reciente' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Correo confirmado', exact: true })).toHaveCount(0);
		expect(new URL(page.url()).hash.length).toBe(0);
		await noAppSession(page);
		await health.assertAndAttach(info, 'email-confirmation-invalid-health');
	} finally { await write(f.admin.auth.admin.deleteUser(created.data.user.id)); }
});

test('email confirmation @candidate-behavior: native forms with JavaScript disabled retain a usable exit', async ({ browser }, info) => {
	const f = fixture();
	const email = `confirmation-native-${randomUUID()}@example.test`, password = `Synthetic!${randomUUID()}`;
	const context = await browser.newContext({ baseURL: f.site, javaScriptEnabled: false });
	const page = await context.newPage();
	let userId: string | undefined;
	try {
		await signup(page, email, password);
		await expect(page.locator('noscript')).toContainText('recargá esta página');
		await noAppSession(page);
		await expect.poll(async () => (await messages(f.mail, email)).length, { timeout: 15_000 }).toBe(1);
		await follow(page, await confirmationUrl(f.mail, email, f.origin, f.site));
		// Auth itself confirms the address; fragment cleanup/verified success UI
		// needs JavaScript. The native page explicitly offers password sign-in.
		const login = await f.auth.auth.signInWithPassword({ email, password });
		if (login.error || !login.data.user?.email_confirmed_at) throw new Error('Native email confirmation did not verify the owned account.');
		userId = login.data.user.id;
		await write(f.admin.from('business_users').insert({ business_id: f.businessId, user_id: userId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() }));
		await page.getByRole('link', { name: 'Ya confirmé, ir a ingresar' }).click();
		await signInWithPassword(page, email, password);
		await expect(page.getByRole('link', { name: 'Pacientes', exact: true }).first()).toBeVisible();
		await info.attach('email-confirmation-native-proof', { body: JSON.stringify({ javaScriptEnabled: false, nativeSignup: true, isolatedEmailUrlFollowed: true, providerConfirmed: true, manualPasswordLogin: true, callbackFragmentCleanupRequiresJavaScript: true }), contentType: 'application/json' });
	} finally {
		await context.close();
		if (!userId) {
			const listed = await f.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
			if (listed.error) throw new Error('Owned native signup cleanup lookup failed.');
			userId = listed.data.users.find(user => user.email === email)?.id;
		}
		if (userId) {
			await write(f.admin.from('business_users').delete().eq('business_id', f.businessId).eq('user_id', userId));
			await write(f.admin.auth.admin.deleteUser(userId));
		}
	}
});

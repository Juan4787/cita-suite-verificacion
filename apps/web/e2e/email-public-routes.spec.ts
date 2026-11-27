import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { layoutIssues } from './helpers/layout-usability';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { chooseTheme, contrastViolations, expectRenderedTheme } from './helpers/theme';

// The two routes other servers post to, and the check they are excepted from. That check runs only
// in a production build, so the refusals are asserted on the packaged release. No provider is
// contacted, and no mail is sent.
type Fixture = ReturnType<typeof ownedAppointmentFixture>;

const issueToken = (f: Fixture, email: string, expiresExpr = "now()+interval '1 day'") => {
	const token = randomBytes(32).toString('hex');
	const hash = createHash('sha256').update(token).digest('hex');
	f.sql(`insert into private.email_unsubscribe_tokens(token_hash,business_id,email_normalized,expires_at)
	 values('${hash}',:'business'::uuid,'${email}',${expiresExpr});`);
	return token;
};
const suppressions = (f: Fixture, email: string) =>
	f.sql(`select count(*) from private.email_suppressions where business_id=:'business'::uuid and email_normalized='${email}' and reason='unsubscribe' and lifted_at is null;`);

test('email routes: reading never unsubscribes, posts from other servers work and the exception stays exact', async ({ page, browser, request }, info) => {
	test.setTimeout(120_000);
	const f = ownedAppointmentFixture();
	const nativeEmail = `unsubscribe-native-${randomUUID()}@example.test`;
	const oneClickEmail = `unsubscribe-oneclick-${randomUUID()}@example.test`;
	const origin = new URL(process.env.E2E_BASE_URL ?? '').origin;
	try {
		const token = issueToken(f, nativeEmail);
		const path = `/correo/baja/${token}`;

		// A mail scanner follows the link: opening it changes nothing.
		const scanned = await request.get(path, { headers: { 'user-agent': 'Googlebot' } });
		expect(scanned.status()).toBe(200);
		expect(scanned.headers()['cache-control']).toContain('no-store');
		expect(scanned.headers()['x-robots-tag']).toContain('noindex');
		expect(suppressions(f, nativeEmail)).toBe('0');

		for (const theme of ['light', 'dark'] as const) {
			await page.setViewportSize({ width: 320, height: 800 });
			await page.goto(origin + path);
			await chooseTheme(page, theme);
			await page.reload();
			await expect(page.getByRole('heading', { name: '¿Dejar de recibir estos correos?' })).toBeVisible();
			await expectRenderedTheme(page, theme);
			expect((await contrastViolations(page)).violations).toEqual([]);
			expect(await layoutIssues(page, 'main button:visible', 'main')).toEqual([]);
			await page.screenshot({ path: info.outputPath(`baja-${theme}-320.jpg`), type: 'jpeg', quality: 60 });
		}
		expect(suppressions(f, nativeEmail)).toBe('0');

		// Without JavaScript the page's own form still works, under its no-referrer policy.
		const native = await browser.newContext({ javaScriptEnabled: false, baseURL: origin });
		try {
			const nativePage = await native.newPage();
			await nativePage.goto(path);
			await nativePage.getByRole('button', { name: 'Sí, dejar de recibirlos', exact: true }).click();
			await expect(nativePage.getByRole('status')).toContainText('No vas a recibir más correos');
		} finally {
			await native.close();
		}
		expect(suppressions(f, nativeEmail)).toBe('1');

		// The filter looks only at the method, the type and the origin, so these posts carry no body: a
		// body the handler does not read breaks the next request in the local development proxy.
		const form = { 'content-type': 'application/x-www-form-urlencoded' };

		// The provider's webhook reaches its own handler, which here has no key to accept anything.
		expect((await request.post('/api/zoho/webhook', { headers: form })).status()).toBe(503);

		// The exception is exact: any other path and any other site are still refused. The development
		// server has no origin check, so only the packaged release can prove this.
		if (process.env.CITA_RELEASE_ARTIFACT) {
			for (const refused of [
				await request.post('/odonto/agenda?/create_appointment', { headers: form }),
				await request.post('/odonto/agenda?/create_appointment', { headers: { ...form, origin: 'https://otro-sitio.example' } }),
				await request.post(`${path}/otra`, { headers: form }),
				await request.post('/api/zoho/webhook/otra', { headers: form })
			]) {
				expect(refused.status()).toBe(403);
				expect(await refused.text()).toBe('Cross-site POST form submissions are forbidden');
			}
		}

		// One-click removal (RFC 8058): the mail provider's server posts its fixed body, with no Origin.
		const oneClick = await request.post(`/correo/baja/${issueToken(f, oneClickEmail)}`, { form: { 'List-Unsubscribe': 'One-Click' } });
		expect(oneClick.status()).toBe(200);
		expect(suppressions(f, oneClickEmail)).toBe('1');
	} finally {
		f.sql(`begin;
		 delete from private.email_suppressions where business_id=:'business'::uuid and email_normalized in ('${nativeEmail}','${oneClickEmail}');
		 delete from private.email_unsubscribe_tokens where business_id=:'business'::uuid and email_normalized in ('${nativeEmail}','${oneClickEmail}');
		 commit;`);
	}
});

test('@candidate-behavior D2: enlace de baja vencido muestra contacto público y el inválido da texto general sin pedir responder correo', async ({ page }, info) => {
	test.setTimeout(120_000);
	const f = ownedAppointmentFixture();
	const origin = new URL(process.env.E2E_BASE_URL ?? '').origin;
	const savedContact = f.sql(`select jsonb_build_object('phone',phone,'public_contact_enabled',public_contact_enabled,'whatsapp_phone',whatsapp_phone,'whatsapp_contact_enabled',whatsapp_contact_enabled)::text from public.businesses where id=:'business'::uuid;`);
	const expiredEmail = `unsubscribe-expired-${randomUUID()}@example.test`;
	try {
		f.sql(`update public.businesses set phone='+54 342 429-3471',public_contact_enabled=true,whatsapp_phone='+5493424293471',whatsapp_contact_enabled=true where id=:'business'::uuid;`);
		const expiredPath = `/correo/baja/${issueToken(f, expiredEmail, "now()-interval '1 hour'")}`;
		const invalidPath = `/correo/baja/${'f'.repeat(64)}`;
		for (const theme of ['light', 'dark'] as const) {
			for (const width of [320, 360, 390, 430, 768, 1280]) {
				await page.setViewportSize({ width, height: 800 });
				await page.goto(origin + expiredPath);
				await chooseTheme(page, theme);
				await page.reload();
				await expect(page.getByRole('heading', { name: 'Este enlace venció' })).toBeVisible();
				const expiredBody = (await page.locator('main').textContent()) ?? '';
				expect(expiredBody).toMatch(/WhatsApp o por teléfono/i);
				expect(expiredBody).not.toMatch(/respond[eé]|contest[eé]/i);
				await expect(page.getByRole('link', { name: 'Pedir la baja por WhatsApp' })).toBeVisible();
				await expect(page.getByRole('link', { name: '+54 342 429-3471' })).toBeVisible();
				await expectRenderedTheme(page, theme);
				expect((await contrastViolations(page)).violations).toEqual([]);
				expect(await layoutIssues(page, 'main a:visible, main button:visible', 'main')).toEqual([]);
				if (width === 320 || width === 1280) {
					await page.screenshot({ path: info.outputPath(`baja-vencida-${theme}-${width}.jpg`), type: 'jpeg', quality: 60 });
				}
			}
		}
		// Teclado: los enlaces públicos reciben foco en orden sin trampa
		await page.getByRole('link', { name: 'Pedir la baja por WhatsApp' }).focus();
		await expect(page.getByRole('link', { name: 'Pedir la baja por WhatsApp' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('link', { name: '+54 342 429-3471' })).toBeFocused();
		await page.setViewportSize({ width: 390, height: 800 });
		await page.goto(origin + invalidPath);
		await expect(page.getByRole('heading', { name: 'Este enlace no está disponible' })).toBeVisible();
		const invalidBody = (await page.locator('main').textContent()) ?? '';
		expect(invalidBody).toMatch(/WhatsApp o por teléfono/i);
		expect(invalidBody).not.toMatch(/respond[eé]|contest[eé]/i);
		await expect(page.locator('main a')).toHaveCount(0);
		expect((await contrastViolations(page)).violations).toEqual([]);
		expect(await layoutIssues(page, 'main', 'main')).toEqual([]);
	} finally {
		const prev = JSON.parse(savedContact) as { phone: string | null; public_contact_enabled: boolean; whatsapp_phone: string | null; whatsapp_contact_enabled: boolean };
		const sqlLit = (v: string | null) => (v === null ? 'null' : `'${v.replaceAll("'", "''")}'`);
		f.sql(`begin;
		 update public.businesses set phone=${sqlLit(prev.phone)},public_contact_enabled=${prev.public_contact_enabled},whatsapp_phone=${sqlLit(prev.whatsapp_phone)},whatsapp_contact_enabled=${prev.whatsapp_contact_enabled} where id=:'business'::uuid;
		 delete from private.email_unsubscribe_tokens where business_id=:'business'::uuid and email_normalized='${expiredEmail}';
		 commit;`);
	}
});

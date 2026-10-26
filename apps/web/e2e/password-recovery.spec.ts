import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createFixtureClient, write } from './helpers/fixture-db';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { alignTaskForCapture } from './helpers/task-capture';
import { observeRenderHealth } from './helpers/render-health';
import { signInWithPassword } from './helpers/shared-auth';

// Only disposable Auth links are generated; this never sends a real email or
// claims SMTP delivery. No trace or video may retain the temporary credentials.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('password recovery fixture preflight allows the real Auth SDK only from its owned app origin', async ({ request }) => {
	if (process.env.CITA_E2E_ENVIRONMENT !== 'disposable') throw new Error('Recovery preflight requires an owned disposable origin.');
	const api = process.env.ODONTO_SUPABASE_URL;
	const site = process.env.PUBLIC_SITE_URL;
	if (!api || !site || new URL(api).hostname !== '127.0.0.1' || new URL(site).hostname !== '127.0.0.1') throw new Error('Owned preflight origins are absent.');
	for (const origin of [site, 'https://unrelated.example.test']) {
		const response = await request.fetch(api + '/auth/v1/user', { method: 'OPTIONS', headers: {
			Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'apikey,authorization,x-client-info,x-supabase-api-version'
		} });
		expect(response.status()).toBe(204);
		if (origin === site) {
			expect(response.headers()['access-control-allow-origin']).toBe(site);
			expect(response.headers()['access-control-allow-headers'].split(',')).toContain('x-supabase-api-version');
		} else {
			expect(response.headers()['access-control-allow-origin']).toBeUndefined();
		}
	}
});

test('password recovery with real disposable Auth rejects an unchanged password, saves a new one and rejects recovery token reuse', async ({ page }, info) => {
	if (process.env.CITA_E2E_ENVIRONMENT !== 'disposable') throw new Error('Recovery proof requires owned disposable Auth.');
	const origin = process.env.ODONTO_SUPABASE_URL;
	const key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	const anon = process.env.ODONTO_SUPABASE_ANON_KEY;
	const businessId = process.env.CITA_SUITE_TEST_BUSINESS_ID;
	const site = process.env.PUBLIC_SITE_URL;
	if (!origin || !key || !anon || !businessId || !site || new URL(origin).hostname !== '127.0.0.1' || new URL(site).hostname !== '127.0.0.1')
		throw new Error('Owned recovery fixture is incomplete.');
	const admin = createFixtureClient(origin, key);
	const auth = createFixtureClient(origin, anon);
	const email = `recovery-${randomUUID()}@example.test`;
	const oldPassword = `OldSynthetic!${randomUUID()}`;
	const newPassword = `NewSynthetic!${randomUUID()}`;
	const created = await admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true });
	if (created.error || !created.data.user) throw new Error('Owned recovery user was not created.');
	const user = created.data.user;
	const health = await observeRenderHealth(page, (failure) => failure.method === 'PUT' && failure.path === '/auth/v1/user' && [400, 422].includes(failure.status), 1);
	const issues: LayoutIssue[] = [];
	try {
		await write(admin.from('business_users').insert({ business_id: businessId, user_id: user.id, role: 'owner', status: 'active', accepted_at: new Date().toISOString() }));
		const generatedResult = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: site + '/reset/callback' } });
		if (generatedResult.error || !generatedResult.data.properties) throw new Error('Could not generate the owned recovery link.');
		const generated = generatedResult.data;
		if (generated.user.id !== user.id) throw new Error('Recovery token belongs to an unexpected synthetic identity.');
		// The fixture has no SMTP inbox or email redirect gateway. Validate the
		// one-use token with real Auth, then exercise the actual callback UI. This
		// is explicit token-level proof, not email delivery or a followed email URL.
		const verified = await auth.auth.verifyOtp({ type: 'recovery', token_hash: generated.properties.hashed_token });
		if (verified.error || !verified.data.session) throw new Error('Disposable Auth did not issue a recovery session.');
		const session = verified.data.session;
		const fragment = '#' + new URLSearchParams({ access_token: session.access_token, refresh_token: session.refresh_token, type: 'recovery', expires_in: String(session.expires_in), token_type: session.token_type });
		await page.goto('/reset/callback');
		await expect(page.getByText('El enlace es inválido o expiró. Volvé a solicitarlo.')).toBeVisible();
		await page.evaluate((fragment) => { window.history.replaceState({}, '', '/reset/callback' + fragment); }, fragment);
		try { await page.reload(); } catch { throw new Error('Could not load the owned recovery callback.'); }
		await expect(page.getByLabel('Nueva contraseña')).toBeVisible();
		expect(new URL(page.url()).hash.length).toBe(0);
		await page.getByLabel('Nueva contraseña').fill(oldPassword);
		await page.getByLabel('Confirmar contraseña').fill(oldPassword);
		await page.getByRole('button', { name: 'Guardar nueva contraseña' }).click();
		await expect(page.getByText('Elegí una contraseña diferente a la anterior.')).toBeVisible();
		await expect(page.getByText('Contraseña actualizada correctamente.')).toHaveCount(0);
		for (const width of [320, 390, 768, 1280, 1600]) {
			await page.setViewportSize({ width, height: 900 });
			issues.push(...await layoutIssues(page, 'main input, main button, main a', 'main'));
			await alignTaskForCapture(page.getByRole('heading', { name: 'Restablecer contraseña' }));
			await page.screenshot({ path: info.outputPath(`password-recovery-${width}.jpg`), type: 'jpeg', quality: 65, fullPage: true });
		}
		expect(issues).toEqual([]);
		await page.getByLabel('Nueva contraseña').fill(newPassword);
		await page.getByLabel('Confirmar contraseña').fill(newPassword);
		await page.getByRole('button', { name: 'Guardar nueva contraseña' }).press('Enter');
		await expect(page.getByText('Contraseña actualizada correctamente.')).toBeVisible();
		const oldLogin = await auth.auth.signInWithPassword({ email, password: oldPassword });
		expect(oldLogin.error?.code).toBe('invalid_credentials');
		expect(oldLogin.data.session).toBeNull();
		await signInWithPassword(page, email, newPassword);
		await expect(page.getByRole('button', { name: '+ Nuevo turno', exact: true })).toBeVisible();
		const used = await auth.auth.verifyOtp({ type: 'recovery', token_hash: generated.properties.hashed_token });
		expect(used.error?.code).toBe('otp_expired');
		expect(used.data.session).toBeNull();
		await info.attach('password-recovery-proof', { body: JSON.stringify({ realDisposableAuth: true, unchangedPasswordRejected: true, newPasswordLogin: true, oldPasswordRejected: true, recoveryTokenReuseRejected: true, layoutWidths: [320, 390, 768, 1280, 1600], realEmailDelivered: false, emailUrlFollowed: false }), contentType: 'application/json' });
	} finally {
		await write(admin.from('business_users').delete().eq('business_id', businessId).eq('user_id', user.id));
		await write(admin.auth.admin.deleteUser(user.id));
		await health.assertAndAttach(info, 'password-recovery-render-health');
	}
});

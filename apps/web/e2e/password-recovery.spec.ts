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

test('password recovery with real disposable Auth rejects an unchanged password, saves a new one and rejects email link reuse', async ({ page, request }, info) => {
	if (process.env.CITA_E2E_ENVIRONMENT !== 'disposable') throw new Error('Recovery proof requires owned disposable Auth.');
	const origin = process.env.ODONTO_SUPABASE_URL;
	const key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	const businessId = process.env.CITA_SUITE_TEST_BUSINESS_ID;
	const site = process.env.PUBLIC_SITE_URL;
	if (!origin || !key || !businessId || !site || new URL(origin).hostname !== '127.0.0.1' || new URL(site).hostname !== '127.0.0.1')
		throw new Error('Owned recovery fixture is incomplete.');
	const admin = createFixtureClient(origin, key);
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
		const action = new URL(generated.properties.action_link);
		if (action.origin !== origin || action.pathname !== '/auth/v1/verify') throw new Error('Recovery link targets an unexpected service.');
		const verified = await request.get(action.href, { maxRedirects: 0 });
		expect([302, 303].includes(verified.status())).toBe(true);
		const destination = new URL(verified.headers().location ?? '', site);
		if (destination.origin !== site || destination.pathname !== '/reset/callback' || !new URLSearchParams(destination.hash.slice(1)).has('access_token'))
			throw new Error('Disposable Auth did not issue the expected recovery session.');
		await page.goto('/reset/callback');
		await page.evaluate((fragment) => { window.history.replaceState({}, '', '/reset/callback' + fragment); }, destination.hash);
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
		const oldLogin = await admin.auth.signInWithPassword({ email, password: oldPassword });
		expect(oldLogin.error?.code).toBe('invalid_credentials');
		expect(oldLogin.data.session).toBeNull();
		await signInWithPassword(page, email, newPassword);
		await expect(page.getByRole('button', { name: '+ Nuevo turno', exact: true })).toBeVisible();
		const used = await request.get(action.href, { maxRedirects: 0 });
		expect([302, 303].includes(used.status())).toBe(true);
		const rejected = new URL(used.headers().location ?? '', site);
		expect(new URLSearchParams(rejected.hash.slice(1)).has('access_token')).toBe(false);
		await health.assertAndAttach(info, 'password-recovery-render-health');
		await info.attach('password-recovery-proof', { body: JSON.stringify({ realDisposableAuth: true, unchangedPasswordRejected: true, newPasswordLogin: true, oldPasswordRejected: true, emailLinkReuseRejected: true, layoutWidths: [320, 390, 768, 1280, 1600], realEmailDelivered: false }), contentType: 'application/json' });
	} finally {
		await write(admin.from('business_users').delete().eq('business_id', businessId).eq('user_id', user.id));
		await write(admin.auth.admin.deleteUser(user.id));
	}
});

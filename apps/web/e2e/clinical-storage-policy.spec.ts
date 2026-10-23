import { expect, test, type Page } from '@playwright/test';
import { createFixtureClient } from './helpers/fixture-db';
import { browserRequest } from './helpers/browser-request';
import { randomUUID } from 'node:crypto';
import { signInWithPassword } from './helpers/shared-auth';
import { syntheticMasterId } from './helpers/master-identity';

async function captureStorageSurface(page: Page, name: string) {
	for (const width of [1280, 320]) {
		await page.setViewportSize({ width, height: 900 });
		await page.evaluate(() => window.scrollTo(0, 0));
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await page.screenshot({ type: 'jpeg', quality: 65, path: test.info().outputPath(`${name}-${width}.jpg`), fullPage: true });
	}
}

async function assertReadableDesktopNavigation(page: Page) {
	for (const width of [768, 1024, 1280, 1600]) {
		await page.setViewportSize({ width, height: 900 });
		const navigation = page.locator('header nav:visible');
		await expect(navigation).toHaveCount(1);
		await expect.poll(() => navigation.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(104);
		const controls = navigation.locator(':scope > a, :scope > div > button');
		expect(await controls.count()).toBeGreaterThanOrEqual(4);
		await expect.poll(() => controls.evaluateAll(elements => elements
			.filter(element => element.getBoundingClientRect().height > 60 || element.getBoundingClientRect().width < 44)
			.map(element => element.textContent?.trim()))).toEqual([]);
	}
}

test('master storage policy preserves drafts, enforces clinic scope and renders desktop/mobile', async ({ page, browser }) => {
	const url = process.env.ODONTO_SUPABASE_URL;
	const key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	const masterEmail = process.env.MASTER_EMAIL;
	const masterPassword = process.env.E2E_MASTER_PASSWORD;
	if (!url || !key || !masterEmail || !masterPassword) throw new Error('Explicit synthetic storage test identities are required.');
	const admin = createFixtureClient(url, key);
	const original = await admin.from('clinical_storage_budget').select('default_business_max_bytes,uploads_enabled').eq('singleton', true).single();
	if (original.error || !original.data) throw new Error('Cannot preserve the original storage policy.');
	const masterId = await syntheticMasterId(admin.auth.admin, masterEmail, masterPassword);
	const ownerEmail = 'storage-policy-' + randomUUID() + '@example.test';
	const password = 'CitaStoragePolicy!2026';
	const owner = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
	if (owner.error || !owner.data.user) throw new Error('Could not prepare the synthetic clinic owner.');
	const ownerId = owner.data.user.id;
	const businessId = randomUUID();
	const patientId = randomUUID();
	const businessName = 'Consultorio sintético de nombre extenso para comprobar límites de documentos en pantallas pequeñas';
	const ownerContext = await browser.newContext();
	try {
		for (const result of [
			await admin.from('allowed_emails').insert({ email: ownerEmail, enabled: true }),
			await admin.from('businesses').insert({ id: businessId, name: businessName, slug: 'storage-' + businessId, industry: 'other' }),
			await admin.from('business_subscriptions').update({ commercial_access_enabled: true, is_permanent: true, subscription_status: 'active',
				paid_until: null, grace_until: null, restricted_until: null, archived_at: null }).eq('business_id', businessId),
			await admin.from('business_users').insert({ business_id: businessId, user_id: ownerId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() }),
			await admin.from('patients').insert({ id: patientId, business_id: businessId, owner_id: ownerId, full_name: 'Paciente sintético de cuota' })
		]) if (result.error) throw result.error;

		await signInWithPassword(page, masterEmail, masterPassword);
		// A usable server-rendered form must retain edits while its JS is still
		// loading. Hold scripts to reproduce that real condition deterministically.
		let releaseScripts!: () => void;
		const scripts = new Promise<void>(resolve => { releaseScripts = resolve; });
		await page.route('**/*', async route => {
			if (route.request().resourceType() === 'script') await scripts;
			await route.continue();
		});
		const initial = page.getByLabel('Límite inicial por consultorio (MB)');
		try {
			await page.goto('/odonto/maestro/almacenamiento', { waitUntil: 'commit' });
			await expect(page.getByRole('heading', { name: 'Espacio para documentos', exact: true })).toBeVisible();
			await initial.fill('110,5');
		}
		finally { releaseScripts(); }
		// Svelte removes the server's default value attribute when this actual
		// input is hydrated. No arbitrary delay, injected state or repeated fill.
		await expect(initial).not.toHaveAttribute('value');
		await expect(initial).toHaveValue('110,5');
		await page.getByLabel('Permitir nuevas cargas en Cita Suite', { exact: true }).check();
		const submittedDefault = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('?/defaults'));
		await page.getByRole('button', { name: 'Guardar configuración general', exact: true }).click();
		expect(new URLSearchParams((await submittedDefault).postData() ?? '').get('megabytes')).toBe('110,5');
		await expect(page.getByRole('status')).toContainText('Configuración general guardada');
		const updatedDefault = await admin.from('clinical_storage_budget').select('default_business_max_bytes').eq('singleton', true).single();
		expect(updatedDefault.error).toBeNull();
		expect(updatedDefault.data?.default_business_max_bytes).toBe(110500000);
		const row = page.locator('form').filter({ has: page.getByRole('heading', { name: businessName, exact: true }) });
		const quota = row.getByLabel(`Límite de ${businessName} (MB)`);
		await initial.fill('111'); // A different form's pending edit must survive.
		await quota.fill('21');
		await row.getByRole('button', { name: 'Guardar límite', exact: true }).click();
		await expect(row.getByRole('status')).toContainText('Configuración del consultorio guardada');
		await expect(initial).toHaveValue('111');
		// A concurrent administrator must not silently overwrite this form's
		// observed revision. Its error belongs to the row, preserving other edits.
		const concurrent = await admin.rpc('set_business_clinical_storage_policy', { p_actor_id: masterId,
			p_business_id: businessId, p_max_bytes: 22000000, p_uploads_enabled: true });
		expect(concurrent.error).toBeNull();
		await quota.fill('23');
		await row.getByRole('button', { name: 'Guardar límite', exact: true }).click();
		await expect(row.getByRole('alert')).toContainText('Otra persona cambió esta configuración');
		await expect(row.getByRole('alert')).toBeVisible();
		await expect(quota).not.toHaveAttribute('aria-invalid');
		await expect(quota).toHaveValue('23');
		await expect(initial).toHaveValue('111');
		await page.getByRole('link', { name: 'Panel maestro', exact: true }).click();
		const unsaved = page.getByRole('dialog', { name: 'Cambios sin guardar' });
		await expect(unsaved).toBeVisible();
		await unsaved.getByRole('button', { name: 'Seguir editando', exact: true }).click();
		await expect(initial).toHaveValue('111');
		await initial.fill('110,5');
		await quota.fill('21'); // Restore both drafts before the explicit reload.
		await page.reload();
		await expect(quota).toHaveValue('22');
		await quota.fill('1.000');
		await row.getByRole('button', { name: 'Guardar límite', exact: true }).click();
		await expect(row.getByRole('alert')).toContainText('Usá coma');
		await expect(row.getByRole('alert')).toBeVisible();
		await expect(quota).toHaveAttribute('aria-invalid', 'true');
		await expect(quota).toHaveValue('1.000');
		await quota.fill('21');
		await row.getByLabel('Permitir nuevas cargas en este consultorio').uncheck();
		await row.getByRole('button', { name: 'Guardar límite', exact: true }).click();
		await expect(row.getByRole('status')).toContainText('Configuración del consultorio guardada');
		const clinic = await admin.from('clinical_business_storage_budget').select('max_bytes,uploads_enabled').eq('business_id', businessId).single();
		expect(clinic.error).toBeNull();
		expect(clinic.data).toMatchObject({ max_bytes: 21000000, uploads_enabled: false });

		const ownerPage = await ownerContext.newPage();
		await signInWithPassword(ownerPage, ownerEmail, password);
		await ownerPage.goto('/odonto/configuracion/documentos');
		await expect(ownerPage.getByText('La carga de documentos está pausada. Los archivos guardados siguen disponibles.')).toBeVisible();
		await expect(ownerPage.getByRole('button', { name: 'Guardar permisos', exact: true })).toBeDisabled();
		await assertReadableDesktopNavigation(ownerPage);
		await captureStorageSurface(ownerPage, 'storage-clinic-paused');
		const denied = await browserRequest(ownerPage, `/odonto/pacientes/${patientId}/radiografias/uploads`, { method: 'POST', data: {
			clientRequestId: randomUUID(), originalFilename: 'synthetic.pdf', mimeType: 'application/pdf', bytes: 100, sha256: 'a'.repeat(64)
		} });
		expect(denied.status).toBe(409);
		expect((await denied.json()).message).toContain('desactivada');
		const files = await admin.from('patient_radiographs').select('id').eq('business_id', businessId);
		expect(files.error).toBeNull();
		expect(files.data).toHaveLength(0);
		await ownerPage.goto(`/odonto/pacientes/${patientId}?tab=radiografias`);
		await expect(ownerPage.getByText('La carga de documentos está pausada. Podés consultar los documentos guardados.')).toBeVisible();
		await expect(ownerPage.getByText('Los documentos guardados aparecerán en esta ficha.', { exact: true })).toBeVisible();
		await expect(ownerPage.getByText('Podés adjuntar imágenes y estudios', { exact: false })).toHaveCount(0);
		await expect(ownerPage.getByRole('button', { name: 'Añadir documento', exact: true })).toHaveCount(0);
		await captureStorageSurface(ownerPage, 'storage-patient-paused');
		await ownerPage.goto('/odonto/maestro/almacenamiento');
		await expect(ownerPage).not.toHaveURL(/\/maestro/);
		await expect(ownerPage.getByLabel('Límite inicial por consultorio (MB)')).toHaveCount(0);

		await captureStorageSurface(page, 'storage-master');
	} finally {
		await ownerContext.close();
		const restored = await admin.rpc('set_clinical_storage_defaults', { p_actor_id: masterId,
			p_default_business_max_bytes: original.data.default_business_max_bytes, p_uploads_enabled: original.data.uploads_enabled });
		for (const result of [restored,
			await admin.from('businesses').delete().eq('id', businessId),
			await admin.from('allowed_emails').delete().eq('email', ownerEmail),
			await admin.auth.admin.deleteUser(ownerId)
		]) if (result.error) throw new Error('Synthetic storage policy cleanup was incomplete.');
	}
});

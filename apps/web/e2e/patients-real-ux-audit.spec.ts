import { expect, test, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { loginWithSharedSession } from './helpers/shared-auth';

const email = process.env.CITA_SUITE_TEST_EMAIL;
const password = process.env.CITA_SUITE_TEST_PASSWORD;
const businessId = process.env.CITA_SUITE_TEST_BUSINESS_ID;
const supabaseUrl = process.env.ODONTO_SUPABASE_URL;
const serviceRoleKey = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;

const login = async (page: Page) => {
	await loginWithSharedSession(page, {
		email: email ?? '',
		password: password ?? '',
		readyLinkNames: ['Pacientes']
	});
};

const assertTwoLineTab = async (tab: Locator) => {
	const [label, count] = await Promise.all([
		tab.locator('span').nth(0).boundingBox(),
		tab.locator('span').nth(1).boundingBox()
	]);
	expect(label).not.toBeNull();
	expect(count).not.toBeNull();
	expect(count?.y ?? 0).toBeGreaterThan(label?.y ?? 0);
};

test.describe('Auditoría UX sobre la cuenta de prueba real', () => {
	test.skip(
		!email || !password || !businessId || !supabaseUrl || !serviceRoleKey,
		'Requiere CITA_SUITE_TEST_* y ODONTO_SUPABASE_*.'
	);

	test('búsqueda inmediata, layout desktop/mobile y navegación por toda la fila', async ({
		page,
		browser
	}, testInfo) => {
		const admin = createClient(supabaseUrl ?? '', serviceRoleKey ?? '', {
			auth: { autoRefreshToken: false, persistSession: false },
			realtime: { transport: WebSocket }
		});
		const { data: recentPatients, error } = await admin
			.from('patients')
			.select('id, full_name')
			.eq('business_id', businessId)
			.is('archived_at', null)
			.order('activity_at', { ascending: false })
			.limit(30);
		if (error) throw error;
		const target = (recentPatients ?? []).find((patient) =>
			/^[jJ]/.test(String(patient.full_name ?? '').trim())
		);
		test.skip(!target, 'La primera página actual no contiene un paciente cuyo nombre empiece con J.');

		await login(page);
		await page.goto('/odonto/pacientes');
		await expect(
			page.getByRole('main').getByRole('heading', { name: 'Pacientes', exact: true })
		).toBeVisible();
		await assertTwoLineTab(page.getByRole('link', { name: /^Activos/ }));
		await assertTwoLineTab(page.getByRole('link', { name: /^Archivados/ }));
		expect(await page.getByText(/Hay cambios nuevos|Conservamos tu posición/).count()).toBe(0);

		const search = page.getByPlaceholder('Buscar por nombre, DNI o teléfono');
		const started = Date.now();
		await search.fill('J');
		const targetName = page.getByRole('button', {
			name: String(target?.full_name),
			exact: true
		});
		await expect(targetName).toBeVisible({ timeout: 500 });
		const localRenderMs = Date.now() - started;
		expect(localRenderMs).toBeLessThan(500);
		console.log(`real_patient_search_local_render_ms=${localRenderMs}`);
		await testInfo.attach('patient-search-latency', {
			body: Buffer.from(JSON.stringify({ localRenderMs })),
			contentType: 'application/json'
		});

		const clear = page.getByRole('button', { name: 'Limpiar búsqueda' });
		await expect(clear).toBeVisible();
		await page.screenshot({
			path: testInfo.outputPath('patients-desktop.png'),
			fullPage: true
		});
		await clear.click();
		await expect(search).toHaveValue('');
		const row = page.locator('tr').filter({ hasText: String(target?.full_name) });
		await row.locator('td').nth(1).click();
		await expect(page).toHaveURL(new RegExp(`/odonto/pacientes/${target?.id}$`));

		const storageState = await page.context().storageState();
		const mobileContext = await browser.newContext({
			storageState,
			viewport: { width: 390, height: 844 },
			hasTouch: true
		});
		try {
			const mobilePage = await mobileContext.newPage();
			await mobilePage.goto('/odonto/pacientes');
			await expect(
				mobilePage.getByRole('main').getByRole('heading', { name: 'Pacientes', exact: true })
			).toBeVisible();
			await assertTwoLineTab(mobilePage.getByRole('link', { name: /^Activos/ }));
			await assertTwoLineTab(mobilePage.getByRole('link', { name: /^Archivados/ }));
			await mobilePage.screenshot({
				path: testInfo.outputPath('patients-mobile.png'),
				fullPage: true
			});
			const firstCard = mobilePage.locator('article').first();
			await expect(firstCard).toBeVisible();
			await firstCard.click({ position: { x: 24, y: 24 } });
			await expect(mobilePage).toHaveURL(/\/odonto\/pacientes\/[0-9a-f-]+$/);
		} finally {
			await mobileContext.close();
		}
	});
});

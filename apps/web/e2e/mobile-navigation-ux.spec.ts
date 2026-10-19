import { expect, test } from '@playwright/test';
import { loginWithSharedSession } from './helpers/shared-auth';

const email = process.env.E2E_EMAIL ?? process.env.CITA_SUITE_TEST_EMAIL;
const password = process.env.E2E_PASSWORD ?? process.env.CITA_SUITE_TEST_PASSWORD;

test.describe('Odontología mobile - navegación', () => {
	test.skip(
		!email || !password,
		'Definí E2E_EMAIL/E2E_PASSWORD o CITA_SUITE_TEST_EMAIL/CITA_SUITE_TEST_PASSWORD para correr el test mobile.'
	);

	test.use({
		viewport: { width: 390, height: 844 },
		// `isMobile` is not implemented by Firefox. The responsive contract under
		// test is driven by the viewport, so keep this context portable across
		// Chromium, Firefox and WebKit.
		hasTouch: true
	});

	test('menú vertical muestra opciones y cerrar sesión sin rotar el teléfono', async ({ page }) => {
		await loginWithSharedSession(page, {
			email: email ?? '',
			password: password ?? '',
			readyLinkNames: ['Agenda', 'Mis turnos']
		});

		await page.goto('/odonto/agenda');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('button', { name: 'Abrir menú' }).last()).toBeVisible();

		const bottomNav = page.getByRole('navigation', { name: 'Navegación principal' });
		if (await bottomNav.isVisible().catch(() => false)) {
			await expect(bottomNav.getByRole('button', { name: 'Abrir menú' })).toBeVisible();
			await expect(bottomNav.locator('svg').first()).toBeVisible();
			await page.screenshot({ type: 'jpeg', quality: 65, path: test.info().outputPath('mobile-bottom-nav.jpg'), fullPage: false });
		}

		await page.getByRole('button', { name: 'Abrir menú' }).last().click();
		const dialog = page.getByRole('dialog', { name: 'Menú de navegación' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText('Cuenta')).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Salir', exact: true })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Salir', exact: true })).toBeInViewport();
		await page.screenshot({ type: 'jpeg', quality: 65, path: test.info().outputPath('mobile-menu-open.jpg'), fullPage: false });
	});
});

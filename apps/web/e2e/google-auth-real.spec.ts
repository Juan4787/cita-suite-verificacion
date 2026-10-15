import { expect, test } from '@playwright/test';

const googleEmail = process.env.E2E_GOOGLE_EMAIL;
const googlePassword = process.env.E2E_GOOGLE_PASSWORD;
const runRealGoogle = process.env.E2E_GOOGLE_REAL === 'true';

test.describe('Google Auth real', () => {
	test.skip(
		!runRealGoogle || !googleEmail || !googlePassword,
		'Definí E2E_GOOGLE_REAL=true, E2E_GOOGLE_EMAIL y E2E_GOOGLE_PASSWORD para probar Google real.'
	);

	test('crea o ingresa con Google y vuelve a Cita Suite', async ({ page }) => {
		await page.goto('/login');
		await page.getByRole('button', { name: 'Ingresar con Google' }).click();

		await page.waitForURL(/accounts\.google\.com/, { timeout: 30_000 });
		await page
			.getByRole('textbox', { name: /Email or phone|Correo electrónico|Teléfono/i })
			.fill(googleEmail ?? '');
		await page.getByRole('button', { name: /Next|Siguiente/i }).click();

		const passwordBox = page.getByRole('textbox', { name: /Enter your password|Contraseña/i });
		const insecureBrowserBlock = page.getByText(/This browser or app may not be secure/i);
		const nextStep = await Promise.race([
			passwordBox
				.waitFor({ state: 'visible', timeout: 20_000 })
				.then(() => 'password' as const),
			insecureBrowserBlock
				.waitFor({ state: 'visible', timeout: 20_000 })
				.then(() => 'blocked' as const)
		]);
		test.skip(nextStep === 'blocked', 'Google bloqueó el navegador automatizado.');

		await passwordBox.fill(googlePassword ?? '');
		await page.getByRole('button', { name: /Next|Siguiente/i }).click();

		await page.waitForURL(/\/odonto/, { timeout: 60_000 });
		await expect(
			page.getByRole('heading', {
				name: /Activá tu suscripción|Tu acceso a Cita Suite venció|Estamos configurando tu consultorio|Agenda/i
			})
		).toBeVisible();
	});
});

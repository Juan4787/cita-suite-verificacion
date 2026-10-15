import { expect, test } from '@playwright/test';

test.describe('Login/registro - UX', () => {
	test('mantiene crear cuenta y los campos al errar confirmación de contraseña', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');

		const modeNav = page.locator('.ux-pill-nav');
		await modeNav.getByRole('button', { name: 'Crear cuenta' }).click();
		await expect(modeNav.getByRole('button', { name: 'Crear cuenta', exact: true })).toHaveClass(
			/bg-\[#7c3aed\]/
		);

		const email = page.locator('#email');
		const password = page.locator('#password');
		const confirmPassword = page.locator('#confirm_password');

		await email.fill('cliente-ux@example.com');
		await password.fill('secreto123');
		await confirmPassword.fill('distinto123');
		await page.getByRole('checkbox').check();

		const confirmField = page.locator('label').filter({ hasText: 'Confirmar contraseña' });
		await expect(confirmPassword).toHaveAttribute('type', 'password');
		await confirmField.getByRole('button', { name: 'Ver' }).click();
		await expect(confirmPassword).toHaveAttribute('type', 'text');
		await confirmField.getByRole('button', { name: 'Ocultar' }).click();
		await expect(confirmPassword).toHaveAttribute('type', 'password');

		await page.locator('form').first().getByRole('button', { name: 'Crear cuenta', exact: true }).click();

		await expect(page.getByText('Las contraseñas no coinciden.')).toBeVisible();
		await expect(modeNav.getByRole('button', { name: 'Crear cuenta', exact: true })).toHaveClass(/bg-\[#7c3aed\]/);
		await expect(email).toHaveValue('cliente-ux@example.com');
		await expect(password).toHaveValue('secreto123');
		await expect(confirmPassword).toHaveValue('distinto123');
	});
});

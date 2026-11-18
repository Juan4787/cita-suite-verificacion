/** @vitest-environment jsdom */

// Crear la cuenta tarda unos segundos: el botón se bloquea y lo dice, y un segundo clic no vuelve a enviar
// (18-nov-2026: un segundo clic reemplazó la respuesta buena del primero y mostró un error).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import Page from './+page.svelte';

afterEach(() => cleanup());

const renderRegister = () => render(Page, { params: {}, form: null, data: { message: '', initialMode: 'register' } as never });
const credentialsForm = () => document.querySelector('form[action="?/register"]') as HTMLFormElement;

const fillPasswords = async (password: string, confirmation: string) => {
	await fireEvent.input(document.querySelector('#password') as HTMLInputElement, { target: { value: password } });
	await fireEvent.input(screen.getByLabelText('Confirmar contraseña'), { target: { value: confirmation } });
};

describe('botón de crear cuenta e ingresar', () => {
	it('al enviar se bloquea y dice «Creando tu cuenta…»; un segundo envío no sale', async () => {
		renderRegister();
		await fillPasswords('secreta123', 'secreta123');

		const first = new Event('submit', { cancelable: true });
		await fireEvent(credentialsForm(), first);

		const button = within(credentialsForm()).getByRole('button', { name: 'Creando tu cuenta…' });
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute('aria-busy', 'true');
		expect(first.defaultPrevented).toBe(false);

		const second = new Event('submit', { cancelable: true });
		await fireEvent(credentialsForm(), second);
		expect(second.defaultPrevented).toBe(true);
	});

	it('con contraseñas distintas no envía ni bloquea el botón', async () => {
		renderRegister();
		await fillPasswords('secreta123', 'otra4567');

		const submit = new Event('submit', { cancelable: true });
		await fireEvent(credentialsForm(), submit);

		expect(submit.defaultPrevented).toBe(true);
		expect(within(credentialsForm()).getByRole('button', { name: 'Crear cuenta' })).toBeEnabled();
		expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument();
	});

	it('al volver con «Atrás» a la página guardada, el botón vuelve a estar disponible', async () => {
		renderRegister();
		await fillPasswords('secreta123', 'secreta123');
		await fireEvent(credentialsForm(), new Event('submit', { cancelable: true }));
		expect(within(credentialsForm()).getByRole('button', { name: 'Creando tu cuenta…' })).toBeDisabled();

		const restored = new Event('pageshow') as PageTransitionEvent;
		Object.defineProperty(restored, 'persisted', { value: true });
		await fireEvent(window, restored);

		expect(within(credentialsForm()).getByRole('button', { name: 'Crear cuenta' })).toBeEnabled();
	});
});

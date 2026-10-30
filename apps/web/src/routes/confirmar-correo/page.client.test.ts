import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }), deserialize: vi.fn(), applyAction: vi.fn() }));
vi.mock('$app/navigation', () => ({ afterNavigate: vi.fn(), replaceState: vi.fn() }));
import Page from './+page.svelte';

const data = (status: 'pending' | 'confirmed' = 'pending') => ({
	bookingColorMode: 'dark' as const,
	context: { email: 'una-direccion-muy-larga-de-un-consultorio@example.com', status, resendAfter: Date.now() + 60_000, expiresAt: Date.now() + 3600_000 },
	currentEmail: null, entryRoute: '/login'
});
afterEach(cleanup);
describe('confirmation step', () => {
	it('muestra un paso normal y los siguientes pasos, sin alerta ni contraseña', () => {
		render(Page, { params: {}, data: data(), form: null });
		expect(screen.getByRole('heading', { name: 'Revisá tu correo' })).toBeTruthy();
		expect(screen.getByText('una-direccion-muy-larga-de-un-consultorio@example.com')).toBeTruthy();
		expect(screen.queryByRole('alert')).toBeNull();
		expect(document.querySelector('.ux-alert, .confirmation-feedback.error, input[type="password"]')).toBeNull();
		expect(screen.getByRole('button', { name: /Reenviar en/ }).hasAttribute('disabled')).toBe(true);
		expect(screen.getByRole('link', { name: 'Ya confirmé, ir a ingresar' }).getAttribute('href')).toBe('/login');
	});
	it('el estado confirmado ofrece ingresar y no volver a registrarse', () => {
		render(Page, { params: {}, data: data('confirmed'), form: null });
		expect(screen.getByRole('heading', { name: 'Correo confirmado' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Ingresar a mi cuenta' }).getAttribute('href')).toBe('/login');
		expect(screen.queryByRole('button', { name: /Reenviar/ })).toBeNull();
	});
	it('una confirmación anterior nunca tapa el rechazo del enlace actual', () => {
		render(Page, { params: {}, data: data('confirmed'), form: { kind: 'invalid', message: 'Enlace no válido' } });
		expect(screen.queryByRole('heading', { name: 'Correo confirmado' })).toBeNull();
		expect(screen.getByRole('heading', { name: 'Abrí el enlace más reciente' })).toBeTruthy();
		expect(screen.queryByRole('alert')).toBeNull();
	});
	it('el reenvío aceptado es información y no un error rojo', () => {
		render(Page, { params: {}, data: data(), form: { kind: 'notice', message: 'Revisá también el correo no deseado.' } });
		expect(screen.getByRole('status').textContent).toContain('correo no deseado');
		expect(screen.queryByRole('alert')).toBeNull();
	});
	it('sin contexto permite indicar el correo, sin fingir una cuenta creada', () => {
		render(Page, { params: {}, data: { ...data(), context: null }, form: null });
		expect(screen.getByRole('textbox', { name: 'Correo electrónico' }).hasAttribute('required')).toBe(true);
		expect(screen.queryByText(/cuenta se creó/i)).toBeNull();
	});
});

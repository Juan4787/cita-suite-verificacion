import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	auth: { setSession: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() },
	createClient: vi.fn()
}));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', async () => {
	const { onMount } = await import('svelte');
	return {
		afterNavigate: (callback: () => void) => onMount(callback),
		replaceState: (url: string, state: object) => window.history.replaceState(state, '', url)
	};
});
vi.mock('$env/dynamic/public', () => ({ env: {
	PUBLIC_ODONTO_SUPABASE_URL: 'https://recovery.example.test',
	PUBLIC_ODONTO_SUPABASE_ANON_KEY: 'synthetic-public-key'
} }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
import Recovery from './+page.svelte';

beforeEach(() => {
	vi.resetAllMocks();
	mocks.createClient.mockReturnValue({ auth: mocks.auth });
	mocks.auth.setSession.mockResolvedValue({ error: null });
	mocks.auth.updateUser.mockResolvedValue({ error: null });
	mocks.auth.signOut.mockResolvedValue({ error: null });
	window.history.replaceState({}, '', '/reset/callback#access_token=synthetic-access&refresh_token=synthetic-refresh&type=recovery');
});
afterEach(cleanup);

async function submitPassword(value = 'SyntheticNewPassword!2026') {
	await fireEvent.input(await screen.findByLabelText('Nueva contraseña'), { target: { value } });
	await fireEvent.input(screen.getByLabelText('Confirmar contraseña'), { target: { value } });
	const form = screen.getByRole('button', { name: 'Guardar nueva contraseña' }).closest('form');
	if (!form) throw new Error('Recovery form is absent.');
	await fireEvent.submit(form);
	return form;
}

describe('password recovery callback', () => {
	it('initializes the explicit recovery session once and removes the credentials from the address', async () => {
		render(Recovery);
		await screen.findByLabelText('Nueva contraseña');
		expect(mocks.auth.setSession).toHaveBeenCalledExactlyOnceWith({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
		expect(mocks.createClient).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
		});
		expect(window.location.hash).toBe('');
	});

	it('removes credentials even when the provider rejects the expired session', async () => {
		mocks.auth.setSession.mockResolvedValue({ error: { code: 'refresh_token_not_found' } });
		render(Recovery);
		await screen.findByText('No pudimos validar el enlace. Pedí uno nuevo.');
		expect(window.location.hash).toBe('');
		expect(screen.queryByLabelText('Nueva contraseña')).not.toBeInTheDocument();
	});

	it('rejects a link for another action without starting a session', async () => {
		window.history.replaceState({}, '', '/reset/callback#access_token=synthetic-access&refresh_token=synthetic-refresh&type=signup');
		render(Recovery);
		await screen.findByText('El enlace de recuperación no es válido.');
		expect(mocks.auth.setSession).not.toHaveBeenCalled();
		expect(window.location.hash).toBe('');
	});

	it('does not call an unchanged password a successful update and allows a different one', async () => {
		mocks.auth.updateUser.mockResolvedValueOnce({ error: { code: 'same_password', message: 'New password should be different from the old password.' } });
		render(Recovery);
		await submitPassword();
		await screen.findByText('Elegí una contraseña diferente a la anterior.');
		expect(screen.queryByText('Contraseña actualizada correctamente.')).not.toBeInTheDocument();
		expect(mocks.auth.signOut).not.toHaveBeenCalled();
		await submitPassword('AnotherSyntheticPassword!2026');
		await screen.findByText('Contraseña actualizada correctamente.');
		expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
	});

	it('sends a single update while the first response is pending', async () => {
		let finish: ((value: { error: null }) => void) | undefined;
		mocks.auth.updateUser.mockReturnValueOnce(new Promise<{ error: null }>((resolve) => { finish = resolve; }));
		render(Recovery);
		const form = await submitPassword();
		expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
		await fireEvent.submit(form);
		expect(mocks.auth.updateUser).toHaveBeenCalledTimes(1);
		if (!finish) throw new Error('Pending recovery request was not started.');
		finish({ error: null });
		await screen.findByText('Contraseña actualizada correctamente.');
	});

	it('explains a session transport failure without leaving a loading screen', async () => {
		mocks.auth.setSession.mockRejectedValueOnce(new Error('Synthetic transport failure'));
		render(Recovery);
		await screen.findByText('No pudimos validar el enlace. Pedí uno nuevo.');
		expect(window.location.hash).toBe('');
	});

	it('keeps the form usable after a failed update transport', async () => {
		mocks.auth.updateUser.mockRejectedValueOnce(new Error('Synthetic transport failure'));
		render(Recovery);
		await submitPassword();
		await screen.findByText('No pudimos actualizar la contraseña. Intentá de nuevo.');
		expect(screen.getByRole('button', { name: 'Guardar nueva contraseña' })).toBeEnabled();
		expect(mocks.auth.signOut).not.toHaveBeenCalled();
	});

	it('distinguishes a saved password from an unconfirmed session close', async () => {
		mocks.auth.signOut.mockResolvedValueOnce({ error: { code: 'unexpected_failure' } });
		render(Recovery);
		await submitPassword();
		await screen.findByText('La contraseña se actualizó, pero no pudimos confirmar el cierre de la sesión de recuperación. Cerrá esta pestaña e ingresá con tu nueva contraseña.');
		expect(screen.getByRole('link', { name: 'Volver a ingresar' })).toHaveAttribute('href', '/login');
	});
});

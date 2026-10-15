import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	createSupabaseServerClient: vi.fn(),
	getModuleEntryRoute: vi.fn(() => '/odonto/agenda'),
	isMasterEmail: vi.fn(() => false),
	MASTER_EMAIL: 'master@example.com',
	enforceRateLimitsFailOpen: vi.fn(),
	loginPasswordRateLimitRules: vi.fn((email: string, ip: string) => [
		{ action: 'login_password_by_email', subject: email, ip }
	]),
	signupEmailRateLimitRules: vi.fn((email: string, ip: string) => [
		{ action: 'signup_email_by_email', subject: email, ip }
	]),
	RateLimitExceededError: class RateLimitExceededError extends Error {
		status = 429;
		userMessage: string;

		constructor(message: string) {
			super(message);
			this.userMessage = message;
		}
	}
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getModuleEntryRoute: mocks.getModuleEntryRoute,
	isMasterEmail: mocks.isMasterEmail,
	MASTER_EMAIL: mocks.MASTER_EMAIL
}));
vi.mock('$lib/server/rate-limits', () => ({
	enforceRateLimitsFailOpen: mocks.enforceRateLimitsFailOpen,
	loginPasswordRateLimitRules: mocks.loginPasswordRateLimitRules,
	signupEmailRateLimitRules: mocks.signupEmailRateLimitRules,
	RateLimitExceededError: mocks.RateLimitExceededError
}));

const { actions, load } = await import('./+page.server');

const makeEvent = (entries: Record<string, string>) => ({
	request: new Request('https://app.test/login', {
		method: 'POST',
		body: new URLSearchParams(entries)
	}),
	cookies: {
		set: vi.fn()
	},
	fetch: vi.fn(),
	getClientAddress: vi.fn(() => '203.0.113.20')
});

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(mocks.env)) delete mocks.env[key];
	mocks.enforceRateLimitsFailOpen.mockResolvedValue(undefined);
	mocks.isMasterEmail.mockReturnValue(false);
});

describe('login/register server actions', () => {
	it('explica cuando el cierre remoto no pudo confirmarse', () => {
		const result = load({
			locals: { auth: null },
			url: new URL('https://app.test/login?auth_error=logout_failed')
		} as never);

		expect(result).toEqual({
			message:
				'Cerramos esta sesión en este dispositivo, pero no pudimos confirmar el cierre en los demás. Volvé a intentar antes de continuar.'
		});
	});

	it('registra email/password libremente sin consultar allowed_emails', async () => {
		const auth = {
			signUp: vi.fn(async () => ({
				data: { session: { access_token: 'access', refresh_token: 'refresh' } },
				error: null
			}))
		};
		const supabase = { auth, rpc: vi.fn() };
		mocks.createSupabaseServerClient.mockResolvedValue(supabase);

		await expect(
			actions.register(
				makeEvent({
					email: 'nuevo@example.com',
					password: 'secret123',
					confirm_password: 'secret123',
					accepted_terms: 'true'
				}) as never
			)
		).rejects.toMatchObject({ status: 303, location: '/odonto/agenda' });

		expect(mocks.enforceRateLimitsFailOpen).toHaveBeenCalled();
		expect(auth.signUp).toHaveBeenCalledWith({
			email: 'nuevo@example.com',
			password: 'secret123'
		});
		expect(supabase.rpc).not.toHaveBeenCalledWith('is_email_enabled', expect.anything());
	});

	it('rechaza registro email/password si la confirmación no coincide antes de Auth', async () => {
		const auth = { signUp: vi.fn() };
		mocks.createSupabaseServerClient.mockResolvedValue({ auth });

		const result = (await actions.register(
			makeEvent({
				email: 'nuevo@example.com',
				password: 'secret123',
				confirm_password: 'otro123',
				accepted_terms: 'true'
			}) as never
		)) as { status: number; data: { mode?: string; message?: string; email?: string; acceptedTerms?: boolean } };

		expect(result.status).toBe(400);
		expect(result.data.mode).toBe('register');
		expect(result.data.message).toBe('Las contraseñas no coinciden.');
		expect(result.data.email).toBe('nuevo@example.com');
		expect(result.data.acceptedTerms).toBe(true);
		expect(mocks.enforceRateLimitsFailOpen).not.toHaveBeenCalled();
		expect(auth.signUp).not.toHaveBeenCalled();
	});

	it('ingresa sin exigir que el email esté prehabilitado', async () => {
		const auth = {
			signInWithPassword: vi.fn(async () => ({
				data: { session: { access_token: 'access', refresh_token: 'refresh' } },
				error: null
			}))
		};
		const supabase = { auth, rpc: vi.fn() };
		mocks.createSupabaseServerClient.mockResolvedValue(supabase);

		await expect(
			actions.login(
				makeEvent({
					email: 'cliente@example.com',
					password: 'secret123'
				}) as never
			)
		).rejects.toMatchObject({ status: 303, location: '/odonto/agenda' });

		expect(auth.signInWithPassword).toHaveBeenCalledWith({
			email: 'cliente@example.com',
			password: 'secret123'
		});
		expect(supabase.rpc).not.toHaveBeenCalledWith('is_email_enabled', expect.anything());
	});

	it('usa la política fail-open para que el control auxiliar no bloquee el ingreso', async () => {
		const auth = {
			signInWithPassword: vi.fn(async () => ({
				data: { session: { access_token: 'access', refresh_token: 'refresh' } },
				error: null
			}))
		};
		mocks.createSupabaseServerClient.mockResolvedValue({ auth });

		await expect(
			actions.login(
				makeEvent({
					email: 'cliente@example.com',
					password: 'secret123'
				}) as never
			)
		).rejects.toMatchObject({ status: 303, location: '/odonto/agenda' });

		expect(auth.signInWithPassword).toHaveBeenCalledWith({
			email: 'cliente@example.com',
			password: 'secret123'
		});
		expect(mocks.enforceRateLimitsFailOpen).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				fetchImpl: expect.any(Function),
				logContext: 'No se pudo aplicar el control de intentos de ingreso'
			})
		);
	});

	it('informa el límite real de intentos sin intentar autenticar', async () => {
		const auth = { signInWithPassword: vi.fn() };
		mocks.createSupabaseServerClient.mockResolvedValue({ auth });
		mocks.enforceRateLimitsFailOpen.mockRejectedValueOnce(
			new mocks.RateLimitExceededError(
				'Hay demasiados intentos de ingreso para este correo. Volvé a intentar en 15 min.'
			)
		);

		const result = (await actions.login(
			makeEvent({
				email: 'cliente@example.com',
				password: 'secret123'
			}) as never
		)) as { status: number; data: { mode?: string; message?: string; email?: string } };

		expect(result).toMatchObject({
			status: 429,
			data: {
				mode: 'login',
				message: 'Hay demasiados intentos de ingreso para este correo. Volvé a intentar en 15 min.',
				email: 'cliente@example.com'
			}
		});
		expect(auth.signInWithPassword).not.toHaveBeenCalled();
	});

	it('devuelve el error dentro del formulario si falta la configuración de Supabase', async () => {
		mocks.createSupabaseServerClient.mockRejectedValueOnce(
			new Error('Faltan variables de entorno de Supabase')
		);
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = (await actions.login(
			makeEvent({ email: 'cliente@example.com', password: 'secret123' }) as never
		)) as { status: number; data: { mode?: string; message?: string } };

		expect(result).toMatchObject({
			status: 503,
			data: {
				mode: 'login',
				message:
					'El ingreso no está disponible en este momento. Probá de nuevo en unos minutos. Si continúa, contactá a soporte.'
			}
		});
		expect(log).toHaveBeenCalledWith(
			'No se pudo conectar con Supabase Auth durante el ingreso',
			expect.any(Error)
		);
		log.mockRestore();
	});

	it('permite registrar si el control auxiliar está disponible y captura una caída de Auth', async () => {
		mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error('Supabase no disponible'));
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = (await actions.register(
			makeEvent({
				email: 'nuevo@example.com',
				password: 'secret123',
				confirm_password: 'secret123',
				accepted_terms: 'true'
			}) as never
		)) as { status: number; data: { mode?: string; message?: string } };

		expect(result).toMatchObject({
			status: 503,
			data: {
				mode: 'register',
				message:
					'No podemos crear tu cuenta en este momento. Probá de nuevo en unos minutos. Si continúa, contactá a soporte.'
			}
		});
		expect(mocks.enforceRateLimitsFailOpen).toHaveBeenCalled();
		log.mockRestore();
	});

	it('bloquea el registro cuando el límite sí fue alcanzado', async () => {
		mocks.enforceRateLimitsFailOpen.mockRejectedValueOnce(
			new mocks.RateLimitExceededError(
				'Hay demasiados intentos de registro para este correo. Volvé a intentar en 1 h.'
			)
		);

		const result = (await actions.register(
			makeEvent({
				email: 'nuevo@example.com',
				password: 'secret123',
				confirm_password: 'secret123',
				accepted_terms: 'true'
			}) as never
		)) as { status: number; data: { mode?: string; message?: string } };

		expect(result).toMatchObject({
			status: 429,
			data: {
				mode: 'register',
				message: 'Hay demasiados intentos de registro para este correo. Volvé a intentar en 1 h.'
			}
		});
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
	});
});

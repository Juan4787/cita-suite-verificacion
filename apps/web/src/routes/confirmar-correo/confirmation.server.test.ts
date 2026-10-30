import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ env: {} as Record<string, string>, client: vi.fn(), rate: vi.fn(),
	RateLimitExceededError: class extends Error { status = 429; userMessage = 'Too many'; } }));
vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseServerClient: mocks.client, getModuleEntryRoute: () => '/odonto/agenda' }));
vi.mock('$lib/server/platform/rate-limits', () => ({ enforceRateLimitsFailOpen: mocks.rate, signupEmailRateLimitRules: () => [], RateLimitExceededError: mocks.RateLimitExceededError }));
const { actions, load } = await import('./+page.server');

const event = (entries: Record<string, string>, context: object | null = null) => ({
	request: new Request('https://app.example/confirmar-correo', { method: 'POST', body: new URLSearchParams(entries) }),
	cookies: { get: vi.fn(() => context ? JSON.stringify(context) : undefined), set: vi.fn(), delete: vi.fn() },
	fetch: vi.fn(), getClientAddress: () => '203.0.113.22', locals: { auth: null, verifiedUser: null }
});
beforeEach(() => { vi.clearAllMocks(); mocks.rate.mockResolvedValue(undefined); for (const k of Object.keys(mocks.env)) delete mocks.env[k]; });

describe('confirmation page actions', () => {
	it('sin contexto no inventa un correo ni una confirmación', () => {
		expect(load(event({}) as never)).toMatchObject({ context: null, currentEmail: null });
	});
	it('verifica el token con Auth y no crea ni reemplaza sesión de la app', async () => {
		const getUser = vi.fn().mockResolvedValue({ data: { user: { email: 'dueña@example.com', email_confirmed_at: '2026-10-30T12:00:00Z' } }, error: null });
		mocks.client.mockResolvedValue({ auth: { getUser } });
		const e = event({ access_token: 'header.payload.signature', type: 'signup' });
		await expect(actions.confirm(e as never)).rejects.toMatchObject({ status: 303, location: '/confirmar-correo' });
		expect(getUser).toHaveBeenCalledWith('header.payload.signature');
		expect(e.cookies.set).toHaveBeenCalledTimes(1);
		expect(e.cookies.set).toHaveBeenCalledWith('cita-email-confirmation', expect.stringContaining('confirmed'), expect.objectContaining({ httpOnly: true, secure: true }));
		expect(e.cookies.delete).not.toHaveBeenCalled();
	});
	it('un usuario real sin fecha de confirmación no permite el éxito', async () => {
		mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { email: 'nuevo@example.com', email_confirmed_at: null } }, error: null }) } });
		const e = event({ access_token: 'a.b.c', type: 'signup' });
		expect(await actions.confirm(e as never)).toMatchObject({ status: 410, data: { kind: 'invalid' } });
		expect(e.cookies.set).not.toHaveBeenCalled();
	});
	it('el rechazo del proveedor nunca se convierte en correo confirmado', async () => {
		mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { status: 401, message: 'PRIVATE_PROVIDER_ERROR' } }) } });
		const e = event({ access_token: 'a.b.c', type: 'email' });
		const r = await actions.confirm(e as never);
		expect(r).toMatchObject({ status: 410, data: { kind: 'invalid' } });
		expect(JSON.stringify(r)).not.toContain('PRIVATE_PROVIDER_ERROR');
		expect(e.cookies.set).not.toHaveBeenCalled();
	});
	it('recuperación o token inválido se rechazan antes de Auth', async () => {
		for (const entries of [{ access_token: 'a.b.c', type: 'recovery' }, { access_token: 'no-jwt', type: 'signup' }]) {
			expect(await actions.confirm(event(entries) as never)).toMatchObject({ status: 400, data: { kind: 'invalid' } });
		}
		expect(mocks.client).not.toHaveBeenCalled();
	});
	it('una caída real conserva un error humano y una salida', async () => {
		mocks.client.mockRejectedValue(new Error('PRIVATE_CONNECTION_ERROR'));
		const r = await actions.confirm(event({ access_token: 'a.b.c', type: 'signup' }) as never);
		expect(r).toMatchObject({ status: 503, data: { kind: 'error' } });
		expect(JSON.stringify(r)).not.toContain('PRIVATE_CONNECTION_ERROR');
	});
	it('un rechazo temporal del proveedor no se presenta como enlace vencido', async () => {
		mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { status: 503, code: 'unexpected_failure' } }) } });
		expect(await actions.confirm(event({ access_token: 'a.b.c', type: 'signup' }) as never)).toMatchObject({ status: 503, data: { kind: 'error' } });
	});
	it('reenvía una confirmación con el retorno propio y contexto corto', async () => {
		const resend = vi.fn().mockResolvedValue({ error: null }); mocks.client.mockResolvedValue({ auth: { resend } });
		const e = event({ email: ' Cuenta@Example.com ' });
		expect(await actions.resend(e as never)).toMatchObject({ kind: 'notice' });
		expect(resend).toHaveBeenCalledWith({ type: 'signup', email: 'cuenta@example.com', options: { emailRedirectTo: 'https://app.example/confirmar-correo' } });
		expect(e.cookies.set).toHaveBeenCalledWith('cita-email-confirmation', expect.stringContaining('pending'), expect.objectContaining({ maxAge: 3600 }));
	});
	it('durante la espera no solicita otro correo', async () => {
		const e = event({ email: 'a@example.com' }, { email: 'a@example.com', status: 'pending', resendAfter: Date.now() + 60_000, expiresAt: Date.now() + 3600_000 });
		expect(await actions.resend(e as never)).toMatchObject({ status: 429, data: { kind: 'notice' } });
		expect(mocks.client).not.toHaveBeenCalled();
	});
	it('la cuota alcanzada se explica como una espera y no envía', async () => {
		mocks.rate.mockRejectedValue(new mocks.RateLimitExceededError());
		expect(await actions.resend(event({ email: 'a@example.com' }) as never)).toMatchObject({ status: 429, data: { kind: 'notice' } });
		expect(mocks.client).not.toHaveBeenCalled();
	});
	it('una cuenta desconocida obtiene la misma respuesta neutra, sin directorio de usuarios', async () => {
		mocks.client.mockResolvedValue({ auth: { resend: vi.fn().mockResolvedValue({ error: { code: 'user_not_found', status: 404 } }) } });
		expect(await actions.resend(event({ email: 'a@example.com' }) as never)).toMatchObject({ kind: 'notice' });
	});
	it('una falla de envío no anuncia éxito', async () => {
		mocks.client.mockResolvedValue({ auth: { resend: vi.fn().mockResolvedValue({ error: { code: 'unexpected_failure', status: 500 } }) } });
		expect(await actions.resend(event({ email: 'a@example.com' }) as never)).toMatchObject({ status: 503, data: { kind: 'error' } });
	});
	it('no envía en demo ni con formularios inválidos o excesivos', async () => {
		mocks.env.DEMO_MODE = 'true';
		expect(await actions.resend(event({ email: 'a@example.com' }) as never)).toMatchObject({ status: 400, data: { kind: 'notice' } });
		expect(await actions.resend(event({ email: 'incorrecto' }) as never)).toMatchObject({ status: 400, data: { kind: 'error' } });
		expect(await actions.confirm(event({ access_token: 'x'.repeat(17000), type: 'signup' }) as never)).toMatchObject({ status: 400 });
		expect(mocks.client).not.toHaveBeenCalled();
	});
});

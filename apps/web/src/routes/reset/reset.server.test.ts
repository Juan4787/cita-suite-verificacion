import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	createSupabaseServerClient: vi.fn(),
	resetPasswordForEmail: vi.fn()
}));
vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: vi.fn() }));
const { actions } = await import('./+page.server');
function event(email: string) {
	return { request: new Request('https://app.example.test/reset', { method: 'POST', body: new URLSearchParams({ email }) }), fetch: vi.fn() };
}
beforeEach(() => {
	vi.resetAllMocks();
	for (const key of Object.keys(mocks.env)) delete mocks.env[key];
	mocks.createSupabaseServerClient.mockResolvedValue({ auth: { resetPasswordForEmail: mocks.resetPasswordForEmail } });
	mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
});
describe('password recovery request', () => {
	it('normalizes the email and preserves the current production callback', async () => {
		expect(await actions.default(event('  Persona@Example.test ') as never)).toEqual({ success: true, email: 'persona@example.test' });
		expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('persona@example.test', { redirectTo: 'https://app.cita-suite.workers.dev/reset/callback' });
	});
	it('uses the configured site without duplicate slashes', async () => {
		mocks.env.PUBLIC_SITE_URL = 'https://app.example.test///';
		await actions.default(event('persona@example.test') as never);
		expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('persona@example.test', { redirectTo: 'https://app.example.test/reset/callback' });
	});
	it.each(['', 'invalid-address', 'persona @example.test', 'a'.repeat(255) + '@example.test'])('rejects malformed email before asking Auth: %s', async (email) => {
		expect(await actions.default(event(email) as never)).toMatchObject({ status: 400, data: { message: 'Ingresá un correo electrónico válido.' } });
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
	});
	it('keeps the recovery form when Auth configuration is unavailable', async () => {
		mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error('Synthetic configuration failure'));
		expect(await actions.default(event('persona@example.test') as never)).toMatchObject({ status: 503, data: { message: 'No pudimos enviar el correo. Intentá de nuevo en unos minutos.' } });
	});
	it('keeps the recovery form when the sending transport fails', async () => {
		mocks.resetPasswordForEmail.mockRejectedValueOnce(new Error('Synthetic transport failure'));
		expect(await actions.default(event('persona@example.test') as never)).toMatchObject({ status: 503, data: { message: 'No pudimos enviar el correo. Intentá de nuevo en unos minutos.' } });
	});
	it('explains the provider sending limit without disclosing its error', async () => {
		mocks.resetPasswordForEmail.mockResolvedValueOnce({ error: { code: 'over_email_send_rate_limit', message: 'Synthetic internal error' } });
		expect(await actions.default(event('persona@example.test') as never)).toMatchObject({ status: 429, data: { message: 'Hay demasiadas solicitudes. Esperá unos minutos y volvé a intentar.' } });
	});
	it('keeps demo mode disabled without calling Auth', async () => {
		mocks.env.DEMO_MODE = 'true';
		expect(await actions.default(event('persona@example.test') as never)).toMatchObject({ status: 400 });
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
	});
});

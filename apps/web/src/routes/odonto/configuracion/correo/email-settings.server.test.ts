import { beforeEach, describe, expect, it, vi } from 'vitest';

// The settings page with its real parsers and messages; the database is a double. Proves that
// preferences and sender readiness stay separate facts, that a failure of the informative status
// never hides the preferences, and that no reply contact is asked for (plan 12.35). Roles are enforced again in SQL.
const mocks = vi.hoisted(() => ({ resolveActiveBusiness: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc, from: mocks.from })) }));
vi.mock('$lib/server/access/public/business', () => ({ resolveActiveBusiness: mocks.resolveActiveBusiness, demoBusinessContext: vi.fn() }));

const { load, actions } = await import('./+page.server');

const businessId = 'b1000000-0000-4000-8000-000000000003';
const policy = { email_enabled: true, require_email: true, show_cancel: true, show_reschedule: true, require_deposit_on_reschedule: true,
	previous_deposit_disposition: 'forfeit', revision: 3, sender_verified: false };
const status = { domain_state: 'verified', from_address: 'turnos@consultorio.cita-suite.com.ar', reply_to: null, ready: true, producer_enabled: true,
	paused: false, used_24h: 4, daily_limit: 100, needs_review: 1, failed_7d: 0 };
const single = (result: unknown) => ({ select: () => ({ eq: () => ({ single: async () => result }) }) });
const event = (body?: Record<string, string>) => ({
	locals: { auth: { access_token: 'token' } }, fetch: vi.fn(), cookies: { get: vi.fn() },
	request: new Request('https://app.test/odonto/configuracion/correo?/save', { method: 'POST', body: new URLSearchParams(body ?? {}) })
}) as never;

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	mocks.resolveActiveBusiness.mockResolvedValue({ canManage: true, business: { id: businessId } });
	mocks.from.mockReturnValue(single({ data: policy, error: null }));
	mocks.rpc.mockResolvedValue({ data: status, error: null });
});

describe('configuración de correos', () => {
	it('muestra por separado la preferencia y el remitente preparado', async () => {
		const data = await load(event());
		expect(data).toMatchObject({ demo: false, policy: { email_enabled: true, sender_verified: false },
			status: { domainState: 'verified', ready: true, needsReview: 1, dailyLimit: 100 } });
		expect(data).not.toHaveProperty('status.replyTo');
		expect(mocks.rpc).toHaveBeenCalledWith('get_business_email_status', { p_business_id: businessId });
	});

	it('si el estado no se puede leer, las preferencias se siguen viendo', async () => {
		mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
		await expect(load(event())).resolves.toMatchObject({ policy: { revision: 3 }, status: null });
	});

	it('sólo la dueña o la administración entran', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue({ canManage: false, business: { id: businessId } });
		await expect(load(event())).rejects.toMatchObject({ status: 403 });
		await expect(actions.save!(event({ expected_revision: '3' }))).rejects.toMatchObject({ status: 403 });
		expect(mocks.rpc).not.toHaveBeenCalled();
	});

	it('no ofrece guardar un correo de respuesta: los correos no se responden (plan 12.35)', () => {
		expect(actions).not.toHaveProperty('contact');
	});
});

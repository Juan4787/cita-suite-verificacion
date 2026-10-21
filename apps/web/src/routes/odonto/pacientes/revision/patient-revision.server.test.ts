import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getViewerPatientDataRevision: vi.fn(),
	getPatientDataRevision: vi.fn(),
	getOdontoContext: vi.fn(),
	createSupabaseAdminClient: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getOdontoContext }));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	createSupabaseServerClient: vi.fn(async () => ({})),
	getUserIdFromAccessToken: () => 'user-1'
}));
vi.mock('$lib/server/patients/public/patient-data-revision', () => ({
	getPatientDataRevision: mocks.getPatientDataRevision,
	getViewerPatientDataRevision: mocks.getViewerPatientDataRevision,
	patientDataCacheScope: () => 'scope-1'
}));

const { GET } = await import('./+server');

const businessId = '00000000-0000-4000-8000-000000000001';
const event = () =>
	({
		locals: { auth: { access_token: 'test-token' }, verifiedUser: { id: 'user-1', email: null } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() },
		setHeaders: vi.fn(),
		url: new URL(`http://localhost/odonto/pacientes/revision?business_id=${businessId}`)
	}) as never;

describe('patient revision check', () => {
	beforeEach(() => vi.clearAllMocks());

	it('answers the revision the viewer can read', async () => {
		mocks.getViewerPatientDataRevision.mockResolvedValue({
			role: 'owner', canCreatePatient: true, cacheable: true, revision: '7', topic: 'business-data:token'
		});
		const response = await GET(event());
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ businessId, revision: '7', cacheScope: 'scope-1', topic: 'business-data:token' });
	});

	// The viewer function exists in every environment since 20260726030000: without it
	// the check fails, instead of reading the revision with the service role.
	it('fails without a privileged fallback when the viewer function is missing', async () => {
		mocks.getViewerPatientDataRevision.mockRejectedValue({ code: 'PGRST202', message: 'Could not find the function' });
		const response = await GET(event());
		expect(response.status).toBe(500);
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
		expect(mocks.getOdontoContext).not.toHaveBeenCalled();
	});
});

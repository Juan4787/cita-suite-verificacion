import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn(),
	from: vi.fn()
}));

vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient
}));

const { load } = await import('./+page.server');

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';

const context = (
	role: 'owner' | 'admin' | 'professional' | 'reception' = 'owner',
	overrides: Record<string, unknown> = {}
) => ({
	business: { id: BUSINESS_ID, name: 'Consultorio' },
	role,
	access: { canEnterApp: true, canUseBusiness: true },
	assistance: null,
	...overrides
});

const event = (
	url = 'https://app.test/odonto/exportar-datos',
	activeBusiness: ReturnType<typeof context> | null = context()
) =>
	({
		parent: vi.fn().mockResolvedValue({ activeBusiness }),
		url: new URL(url),
		locals: { auth: { access_token: 'access', refresh_token: 'refresh' } },
		fetch
	}) as never;

const patientBuilder = (result: { data: unknown; error: unknown }) => {
	const builder: any = {
		select: vi.fn(() => builder),
		eq: vi.fn(() => builder),
		maybeSingle: vi.fn().mockResolvedValue(result)
	};
	return builder;
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createSupabaseServerClient.mockResolvedValue({ from: mocks.from });
});

describe('pantalla de exportación de datos', () => {
	it.each([
		context('owner'),
		context('admin'),
		context('owner', { access: { canEnterApp: true, canUseBusiness: false } })
	])('permite owner/admin directo también durante acceso restringido', async (activeBusiness) => {
		await expect(load(event(undefined, activeBusiness))).resolves.toEqual({
			scope: 'all_patients',
			patient: null
		});
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
	});

	it.each([
		context('professional'),
		context('reception'),
		context('admin', { assistance: { grantId: 'temporary-help' } }),
		context('owner', { access: { canEnterApp: false, canUseBusiness: false } }),
		context('owner', { business: { id: 'demo-business', name: 'Demo' } })
	])('oculta la ruta a roles o estados no autorizados', async (activeBusiness) => {
		await expect(load(event(undefined, activeBusiness))).rejects.toMatchObject({
			status: 303,
			location: '/odonto/pacientes'
		});
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
	});

	it('carga sólo id y nombre del paciente dentro del consultorio activo', async () => {
		const builder = patientBuilder({
			data: { id: PATIENT_ID, full_name: 'Paciente correcto' },
			error: null
		});
		mocks.from.mockReturnValue(builder);

		await expect(
			load(event(`https://app.test/odonto/exportar-datos?patient_id=${PATIENT_ID}`))
		).resolves.toEqual({
			scope: 'patient',
			patient: { id: PATIENT_ID, name: 'Paciente correcto' }
		});
		expect(mocks.from).toHaveBeenCalledWith('patients');
		expect(builder.select).toHaveBeenCalledWith('id, full_name');
		expect(builder.eq.mock.calls).toEqual([
			['business_id', BUSINESS_ID],
			['id', PATIENT_ID]
		]);
	});

	it('rechaza un identificador inválido antes de consultar la base', async () => {
		await expect(
			load(event('https://app.test/odonto/exportar-datos?patient_id=no-es-un-id'))
		).rejects.toMatchObject({
			status: 400,
			body: { message: expect.stringContaining('Volvé a su ficha') }
		});
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
	});

	it('no revela si un paciente pertenece a otro consultorio', async () => {
		mocks.from.mockReturnValue(patientBuilder({ data: null, error: null }));
		await expect(
			load(event(`https://app.test/odonto/exportar-datos?patient_id=${PATIENT_ID}`))
		).rejects.toMatchObject({
			status: 404,
			body: { message: 'No encontramos ese paciente en el consultorio activo.' }
		});
	});

	it('convierte fallos de lectura en un mensaje humano', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mocks.from.mockReturnValue(
			patientBuilder({ data: null, error: { code: '42501', message: 'private SQL detail' } })
		);

		await expect(
			load(event(`https://app.test/odonto/exportar-datos?patient_id=${PATIENT_ID}`))
		).rejects.toMatchObject({
			status: 500,
			body: { message: expect.not.stringMatching(/42501|SQL|private/i) }
		});
		expect(consoleError).toHaveBeenCalledOnce();
	});
});

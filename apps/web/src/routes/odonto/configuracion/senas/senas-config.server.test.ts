import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	resolveActiveBusiness: vi.fn(),
	loadDepositPolicy: vi.fn(),
	saveDepositPolicy: vi.fn(),
	loadDepositAutomationStatus: vi.fn(),
	logServerFailure: vi.fn(),
	tables: {} as Record<string, { data: unknown; error: unknown }>
}));

// Each table answers with its configured result, whatever the chain of filters.
const query = (table: string) => {
	const builder: Record<string, unknown> = {};
	for (const method of ['select', 'eq', 'order']) builder[method] = () => builder;
	builder.maybeSingle = async () => mocks.tables[table];
	builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
		Promise.resolve(mocks.tables[table]).then(resolve, reject);
	return builder;
};

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseServerClient: vi.fn(async () => ({ from: query })) }));
vi.mock('$lib/server/access/public/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness,
	demoBusinessContext: vi.fn()
}));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: mocks.logServerFailure }));
vi.mock('$lib/server/scheduling/public/deposits', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/scheduling/public/deposits')>()),
	loadDepositPolicy: mocks.loadDepositPolicy,
	saveDepositPolicy: mocks.saveDepositPolicy,
	loadDepositAutomationStatus: mocks.loadDepositAutomationStatus
}));

const { load, actions } = await import('./+page.server');
const { DEFAULT_DEPOSIT_POLICY, DepositError } = await import('$lib/server/scheduling/public/deposits');

const BUSINESS_ID = '00000000-0000-4000-8000-0000000000b1';
const ALL = '00000000-0000-4000-8000-0000000000d1';
const SOME = '00000000-0000-4000-8000-0000000000d2';
const NONE = '00000000-0000-4000-8000-0000000000d3';

const event = (form?: Record<string, string | string[]>) => {
	const body = new URLSearchParams();
	for (const [name, value] of Object.entries(form ?? {})) for (const item of [value].flat()) body.append(name, item);
	return {
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() },
		request: new Request('http://localhost/odonto/configuracion/senas?/save', { method: 'POST', body })
	} as never;
};

const validForm = (overrides: Record<string, string | string[]> = {}) => ({
	expected_revision: '2',
	enabled: 'true',
	auto_cancel_enabled: 'true',
	amount_mode: 'fixed',
	fixed_amount: '40.000',
	percentage: '',
	request_days: '7',
	deadline_hours: '48',
	min_payment_hours: '24',
	transfer_details: 'Alias natalia.frutos',
	applies_to_manual: 'true',
	excluded_service_ids: [NONE],
	...overrides
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolveActiveBusiness.mockResolvedValue({ business: { id: BUSINESS_ID }, role: 'owner', canManage: true });
	mocks.loadDepositPolicy.mockResolvedValue({ ...DEFAULT_DEPOSIT_POLICY, revision: 2 });
	mocks.loadDepositAutomationStatus.mockResolvedValue({ enabled: true, lastRunFinishedAt: null });
	mocks.tables = {
		services: { data: [{ id: ALL, name: 'Consulta' }, { id: SOME, name: 'Control' }, { id: NONE, name: 'Taller' }], error: null },
		service_price_policies: { data: [{ service_id: ALL, professional_id: null }, { service_id: SOME, professional_id: 'professional-1' }], error: null },
		businesses: { data: { whatsapp_phone: '+543421234567', whatsapp_contact_enabled: true }, error: null }
	};
});

describe('Configuración de señas · carga', () => {
	it('sólo dueña y administración configuran', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue({ business: { id: BUSINESS_ID }, role: 'professional', canManage: false });
		await expect(load(event())).rejects.toMatchObject({ status: 303, location: '/odonto/mis-turnos' });
		mocks.resolveActiveBusiness.mockResolvedValue({ business: { id: BUSINESS_ID }, role: 'reception', canManage: false });
		await expect(load(event())).rejects.toMatchObject({ status: 303, location: '/odonto/agenda' });
	});

	it('clasifica el arancel de cada prestación como lo busca la base', async () => {
		const result = (await load(event())) as { services: Array<{ id: string; fee: string }>; whatsappConfigured: boolean; automationStopped: boolean };
		expect(result.services.map((service) => [service.id, service.fee])).toEqual([[ALL, 'all'], [SOME, 'some'], [NONE, 'none']]);
		expect(result).toMatchObject({ whatsappConfigured: true, automationStopped: false });
	});

	it('advierte si el WhatsApp del consultorio no está habilitado o la automatización está detenida', async () => {
		mocks.tables.businesses = { data: { whatsapp_phone: '+543421234567', whatsapp_contact_enabled: false }, error: null };
		mocks.loadDepositAutomationStatus.mockResolvedValue({ enabled: false, lastRunFinishedAt: null });
		await expect(load(event())).resolves.toMatchObject({ whatsappConfigured: false, automationStopped: true });
		mocks.tables.businesses = { data: { whatsapp_phone: '  ', whatsapp_contact_enabled: true }, error: null };
		await expect(load(event())).resolves.toMatchObject({ whatsappConfigured: false });
	});

	it('si no puede leer la política o las prestaciones es un error explícito', async () => {
		mocks.tables.service_price_policies = { data: null, error: { message: 'read failed' } };
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
	});
});

describe('Configuración de señas · guardar', () => {
	it('guarda la política completa a la revisión que se leyó', async () => {
		mocks.saveDepositPolicy.mockResolvedValue(3);
		await expect(actions.save(event(validForm()))).resolves.toMatchObject({ success: true, revision: 3 });
		expect(mocks.saveDepositPolicy).toHaveBeenCalledWith(expect.anything(), {
			businessId: BUSINESS_ID,
			expectedRevision: 2,
			policy: expect.objectContaining({ enabled: true, fixedAmount: 40000, excludedServiceIds: [NONE] })
		});
	});

	it('con datos inválidos no llama a la base y devuelve lo escrito', async () => {
		const result = await actions.save(event(validForm({ fixed_amount: '40000,50' })));
		expect(result).toMatchObject({ status: 400, data: { errors: { fixed_amount: expect.any(String) }, values: { fixedAmount: '40000,50' } } });
		expect(mocks.saveDepositPolicy).not.toHaveBeenCalled();
	});

	it('una revisión ausente o mal formada es un conflicto, nunca un guardado a ciegas', async () => {
		await expect(actions.save(event(validForm({ expected_revision: '' })))).resolves.toMatchObject({ status: 409 });
		await expect(actions.save(event(validForm({ expected_revision: 'dos' })))).resolves.toMatchObject({ status: 409 });
		expect(mocks.saveDepositPolicy).not.toHaveBeenCalled();
	});

	it('la regla de la base vuelve con su mensaje y lo escrito; una falla inesperada se registra', async () => {
		mocks.saveDepositPolicy.mockRejectedValue(new DepositError('DEPOSIT_POLICY_CHANGED'));
		await expect(actions.save(event(validForm()))).resolves.toMatchObject({
			status: 409,
			data: { message: expect.stringMatching(/Otra persona cambió la configuración/), values: { enabled: true } }
		});
		expect(mocks.logServerFailure).not.toHaveBeenCalled();
		mocks.saveDepositPolicy.mockRejectedValue(new Error('network'));
		await expect(actions.save(event(validForm()))).resolves.toMatchObject({ status: 500 });
		expect(mocks.logServerFailure).toHaveBeenCalled();
	});

	it('al apagarla avisa que las pendientes quedaron exceptuadas', async () => {
		mocks.saveDepositPolicy.mockResolvedValue(3);
		const form = validForm();
		delete (form as Record<string, unknown>).enabled;
		await expect(actions.save(event(form))).resolves.toMatchObject({
			message: 'Configuración guardada: el consultorio no pide señas. Si había señas pendientes, quedaron exceptuadas.'
		});
	});
});

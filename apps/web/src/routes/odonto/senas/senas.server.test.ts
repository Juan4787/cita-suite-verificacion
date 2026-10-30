import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	resolveActiveBusiness: vi.fn(),
	loadDepositPolicy: vi.fn(),
	loadDepositList: vi.fn(),
	loadDepositAutomationStatus: vi.fn(),
	setAppointmentDeposit: vi.fn(),
	loadRebookUrl: vi.fn(),
	loadRebookUrls: vi.fn(),
	logServerFailure: vi.fn(),
	rpc: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc }))
}));
vi.mock('$lib/server/access/public/business', () => ({ resolveActiveBusiness: mocks.resolveActiveBusiness }));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: mocks.logServerFailure }));
vi.mock('$lib/server/integrations/public/messaging', () => ({ getPublicSiteUrl: () => 'https://app.test' }));
vi.mock('$lib/server/scheduling/public/public-appointments', () => ({ loadRebookUrl: mocks.loadRebookUrl, loadRebookUrls: mocks.loadRebookUrls }));
// The real error codes, messages and statuses; only the database reads are replaced.
vi.mock('$lib/server/scheduling/public/deposits', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/scheduling/public/deposits')>()),
	loadDepositPolicy: mocks.loadDepositPolicy,
	loadDepositList: mocks.loadDepositList,
	loadDepositAutomationStatus: mocks.loadDepositAutomationStatus,
	setAppointmentDeposit: mocks.setAppointmentDeposit
}));

const { load, actions } = await import('./+page.server');
const { DepositError } = await import('$lib/server/scheduling/public/deposits');

const BUSINESS_ID = '00000000-0000-4000-8000-0000000000b1';
const APPOINTMENT_ID = '00000000-0000-4000-8000-0000000000a1';
const OPENER = '00000000-0000-4000-8000-0000000000c1';
const TIMEZONE = 'America/Argentina/Cordoba';

const context = (overrides: Record<string, unknown> = {}) => ({
	business: { id: BUSINESS_ID, name: 'Consultorio', slug: 'consultorio', timezone: TIMEZONE },
	role: 'reception',
	canOperate: true,
	canManage: false,
	access: { canUseBusiness: true },
	...overrides
});

const event = (form?: Record<string, string>, search = '') =>
	({
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() },
		url: new URL('http://localhost/odonto/senas' + search),
		request: new Request('http://localhost/odonto/senas?/deposit', { method: 'POST', body: new URLSearchParams(form ?? {}) })
	}) as never;

const deposit = (overrides: Record<string, unknown> = {}) => ({
	appointment_id: APPOINTMENT_ID,
	status: 'pending',
	amount: 40000,
	currency: 'ARS',
	request_from: '2026-11-13T03:00:00.000Z',
	due_at: '2026-11-18T13:00:00.000Z',
	auto_cancel: true,
	waived_reason: null,
	recorded_at: null,
	reminder_opened_at: null,
	expired_at: null,
	revision: 3,
	...overrides
});

const item = (section: string, overrides: Record<string, unknown> = {}) => ({
	deposit: deposit(),
	reminderOpenedBy: null,
	section,
	appointment: {
		id: APPOINTMENT_ID,
		startsAt: '2026-11-20T13:00:00.000Z',
		status: 'reserved',
		token: 'token',
		professionalId: 'professional-1',
		serviceId: 'service-1'
	},
	patient: { id: 'patient-1', name: 'Ana Pérez', phoneE164: '+5493421112222' },
	...overrides
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolveActiveBusiness.mockResolvedValue(context());
	mocks.loadDepositPolicy.mockResolvedValue({ enabled: true, autoCancelEnabled: true, transferDetails: 'Alias' });
	mocks.loadDepositList.mockResolvedValue({ items: [], truncated: false });
	mocks.loadDepositAutomationStatus.mockResolvedValue({ enabled: true, lastRunFinishedAt: new Date().toISOString() });
	mocks.rpc.mockResolvedValue({ data: [{ user_id: OPENER, email: 'aye@consultorio.test' }], error: null });
	mocks.loadRebookUrl.mockResolvedValue('/embed/v1/0123456789abcdef0123456789abcdef');
	mocks.loadRebookUrls.mockResolvedValue(new Map([[APPOINTMENT_ID, '/embed/v1/0123456789abcdef0123456789abcdef']]));
});

describe('Señas · carga', () => {
	it('resuelve una página de canceladas en un lote, sin consultas por cada turno', async () => {
		const ids = Array.from({ length: 300 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
		mocks.loadDepositList.mockResolvedValue({ items: ids.map(id => item('cancelled', { appointment: { ...item('x').appointment, id } })), truncated: false });
		await load(event());
		expect(mocks.loadRebookUrl).not.toHaveBeenCalled();
		expect(mocks.loadRebookUrls).toHaveBeenCalledExactlyOnceWith(expect.anything(), { id: BUSINESS_ID, slug: 'consultorio' }, ids);
	});
	it('carga la página pedida y normaliza las páginas inválidas sin consultas ilimitadas', async () => {
		await expect(load(event(undefined, '?pagina=2'))).resolves.toMatchObject({ page: 2 });
		expect(mocks.loadDepositList).toHaveBeenLastCalledWith(expect.anything(), BUSINESS_ID, expect.any(Date), 2);
		for (const page of ['0', '-1', '1000001', 'dos', '2.5']) {
			await expect(load(event(undefined, `?pagina=${page}`))).resolves.toMatchObject({ page: 1 });
		}
	});
	it('las profesionales y la lectura sola van a sus páginas: no registran señas', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context({ role: 'professional' }));
		await expect(load(event())).rejects.toMatchObject({ status: 303, location: '/odonto/mis-turnos' });
		mocks.resolveActiveBusiness.mockResolvedValue(context({ role: 'readonly' }));
		await expect(load(event())).rejects.toMatchObject({ status: 303, location: '/odonto/agenda' });
		expect(mocks.loadDepositList).not.toHaveBeenCalled();
	});

	it('un consultorio restringido no lista ni lee señas', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context({ access: { canUseBusiness: false } }));
		await expect(load(event())).resolves.toMatchObject({ restricted: true, automation: null });
		expect(mocks.loadDepositList).not.toHaveBeenCalled();
	});

	it('si no puede leer la lista es un error explícito, nunca una lista vacía', async () => {
		mocks.loadDepositList.mockRejectedValue(new Error('read failed'));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
	});

	it('agrupa en el orden del plan y dice quién abrió el pedido', async () => {
		mocks.loadDepositList.mockResolvedValue({
			items: [
				item('due_soon', { reminderOpenedBy: OPENER, deposit: deposit({ reminder_opened_at: '2026-11-17T10:00:00.000Z' }) }),
				item('to_request', { reminderOpenedBy: 'ajeno', deposit: deposit({ reminder_opened_at: '2026-11-17T09:00:00.000Z' }) })
			],
			truncated: false
		});
		const result = (await load(event())) as { sections: Array<{ id: string; rows: Array<Record<string, unknown>> }> };
		expect(result.sections.map((section) => section.id)).toEqual(['to_request', 'due_soon', 'manual', 'overdue', 'later', 'cancelled']);
		expect(result.sections[1].rows[0]).toMatchObject({ reminder: { openedBy: 'aye@consultorio.test' }, revision: 3, hasPhone: true });
		expect(result.sections[0].rows[0]).toMatchObject({ reminder: { openedBy: 'alguien del equipo' } });
	});

	it('una cancelada por la seña ofrece avisarle a la persona, con dónde reservar, y volver a dar el horario', async () => {
		mocks.loadDepositList.mockResolvedValue({
			items: [item('cancelled', { deposit: deposit({ status: 'expired', expired_at: '2026-11-18T13:05:00.000Z' }), appointment: { ...item('x').appointment, status: 'cancelled' } })],
			truncated: false
		});
		const result = (await load(event())) as { sections: Array<{ id: string; rows: Array<{ cancellation: { rebookHref: string; notice: { whatsappUrl: string } | null } }> }> };
		const row = result.sections.find((section) => section.id === 'cancelled')!.rows[0];
		const rebook = new URL(row.cancellation.rebookHref, 'http://localhost');
		expect(rebook.pathname).toBe('/odonto/agenda');
		expect(Object.fromEntries(rebook.searchParams)).toEqual({
			date: '2026-11-20',
			professional_id: 'professional-1',
			service_id: 'service-1',
			patient_id: 'patient-1',
			hora: '10:00'
		});
		const message = new URL(row.cancellation.notice!.whatsappUrl).searchParams.get('text');
		expect(message).toContain('se canceló porque no registramos la seña');
		expect(message).toContain('https://app.test/embed/v1/0123456789abcdef0123456789abcdef');
	});

	it('sin teléfono válido no arma el aviso, y una falla al buscar dónde reservar no lo impide', async () => {
		mocks.loadRebookUrls.mockRejectedValue(new Error('read failed'));
		mocks.loadDepositList.mockResolvedValue({
			items: [
				item('cancelled', { deposit: deposit({ status: 'expired', expired_at: '2026-11-18T13:05:00.000Z' }) }),
				item('cancelled', {
					deposit: deposit({ status: 'expired', expired_at: '2026-11-18T13:05:00.000Z' }),
					patient: { id: 'patient-2', name: 'Sin Teléfono', phoneE164: null }
				})
			],
			truncated: false
		});
		const result = (await load(event())) as { sections: Array<{ id: string; rows: Array<{ hasPhone: boolean; cancellation: { notice: { whatsappUrl: string } | null } }> }> };
		const [withPhone, withoutPhone] = result.sections.find((section) => section.id === 'cancelled')!.rows;
		expect(new URL(withPhone.cancellation.notice!.whatsappUrl).searchParams.get('text')).not.toContain('reservarlo acá');
		expect(withoutPhone).toMatchObject({ hasPhone: false, cancellation: { notice: null } });
	});

	it('si no puede comprobar la revisión automática lo dice, sin ocultar la lista', async () => {
		mocks.loadDepositAutomationStatus.mockRejectedValue(new Error('read failed'));
		await expect(load(event())).resolves.toMatchObject({
			automation: { tone: 'warning', text: 'No pudimos comprobar la revisión automática. Revisá a mano las señas vencidas.' }
		});
	});

	it('la dueña y la administración ven el enlace a la configuración', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue(context({ role: 'owner', canManage: true }));
		await expect(load(event())).resolves.toMatchObject({ canConfigure: true });
	});
});

describe('Señas · registrar', () => {
	const post = (overrides: Record<string, string> = {}) =>
		actions.deposit(event({ appointment_id: APPOINTMENT_ID, deposit_action: 'paid', expected_revision: '3', ...overrides }));

	it('un identificador mal formado o una acción desconocida no llegan a la base', async () => {
		await expect(post({ appointment_id: 'no-es-uuid' })).resolves.toMatchObject({ status: 404 });
		await expect(post({ deposit_action: 'borrar' })).resolves.toMatchObject({ status: 400 });
		expect(mocks.setAppointmentDeposit).not.toHaveBeenCalled();
	});

	it('una revisión ausente o mal formada no llega a la base', async () => {
		for (const expected_revision of ['', '0', 'tres', '3.5']) {
			await expect(post({ expected_revision })).resolves.toMatchObject({
				status: 400,
				data: { message: 'No pudimos leer la versión de la seña. Recargá la página antes de seguir.' }
			});
		}
		expect(mocks.setAppointmentDeposit).not.toHaveBeenCalled();
	});

	it('confirma la seña con la revisión que vio la persona', async () => {
		mocks.setAppointmentDeposit.mockResolvedValue({ status: 'paid', revision: 4, appointmentStatus: 'confirmed' });
		await expect(post()).resolves.toEqual({
			success: true,
			appointmentId: APPOINTMENT_ID,
			message: 'Seña confirmada. El turno quedó Confirmado.'
		});
		expect(mocks.setAppointmentDeposit).toHaveBeenCalledWith(expect.anything(), {
			businessId: BUSINESS_ID,
			appointmentId: APPOINTMENT_ID,
			action: 'paid',
			expectedRevision: 3
		});
	});

	it('una regla de la seña devuelve su estado y su mensaje', async () => {
		mocks.setAppointmentDeposit.mockRejectedValue(new DepositError('DEPOSIT_CHANGED'));
		await expect(post()).resolves.toMatchObject({
			status: 409,
			data: { message: 'Otra persona actualizó esta seña mientras la mirabas. Revisá su estado actual antes de seguir.' }
		});
		expect(mocks.logServerFailure).not.toHaveBeenCalled();
	});

	it('cualquier otra falla es inesperada: se registra y no se adivina el motivo', async () => {
		mocks.setAppointmentDeposit.mockRejectedValue(Object.assign(new Error('network'), { code: 'DEPOSIT_CHANGED' }));
		await expect(post()).resolves.toMatchObject({ status: 500 });
		expect(mocks.logServerFailure).toHaveBeenCalled();
	});
});

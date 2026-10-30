import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	resolveActiveBusiness: vi.fn(),
	loadDepositPolicy: vi.fn(),
	openDepositReminder: vi.fn(),
	logServerFailure: vi.fn(),
	row: { data: null as unknown, error: null as unknown },
	filters: [] as Array<[string, unknown]>
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseServerClient: vi.fn(async () => ({
		from: () => {
			const builder: Record<string, unknown> = {};
			builder.select = () => builder;
			builder.eq = (column: string, value: unknown) => {
				mocks.filters.push([column, value]);
				return builder;
			};
			builder.maybeSingle = async () => mocks.row;
			return builder;
		}
	}))
}));
vi.mock('$lib/server/access/public/business', () => ({ resolveActiveBusiness: mocks.resolveActiveBusiness }));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: mocks.logServerFailure }));
vi.mock('$lib/server/integrations/public/messaging', () => ({ publicAppointmentUrl: (token: string) => `https://app.test/turno/${token}` }));
vi.mock('$lib/server/scheduling/public/deposits', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/scheduling/public/deposits')>()),
	loadDepositPolicy: mocks.loadDepositPolicy,
	openDepositReminder: mocks.openDepositReminder
}));

const { GET } = await import('./+server');
const { DepositError } = await import('$lib/server/scheduling/public/deposits');

const BUSINESS_ID = '00000000-0000-4000-8000-0000000000b1';
const APPOINTMENT_ID = '00000000-0000-4000-8000-0000000000a1';

const depositRow = (overrides: Record<string, unknown> = {}, patient: Record<string, unknown> = {}) => ({
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
	appointments: {
		starts_at: '2026-11-20T13:00:00.000Z',
		status: 'reserved',
		confirmation_token: 'token-1',
		patients: { full_name: 'Ana Pérez', phone_e164: '+5493421112222', blocked: false, ...patient }
	},
	...overrides
});

const event = (search = '', appointmentId = APPOINTMENT_ID, userAgent = 'Mozilla/5.0 (Linux; Android 14)') =>
	({
		params: { appointmentId },
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() },
		url: new URL(`http://localhost/odonto/senas/abrir/${appointmentId}${search}`),
		request: new Request('http://localhost/', { headers: { 'user-agent': userAgent } })
	}) as never;

const redirectOf = async (promise: PromiseLike<Response> | Response) => {
	try {
		await promise;
	} catch (thrown) {
		return thrown as { status: number; location: string };
	}
	throw new Error('Expected a redirect back to the list');
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.filters.length = 0;
	mocks.row = { data: depositRow(), error: null };
	mocks.resolveActiveBusiness.mockResolvedValue({
		business: { id: BUSINESS_ID, name: 'Consultorio Frutos', timezone: 'America/Argentina/Cordoba' },
		canOperate: true
	});
	mocks.loadDepositPolicy.mockResolvedValue({ autoCancelEnabled: true, transferDetails: 'Alias natalia.frutos' });
	mocks.openDepositReminder.mockResolvedValue({ previouslyOpenedAt: null });
});

describe('pedir la seña por WhatsApp', () => {
	it('registra la apertura y recién después abre WhatsApp con el pedido completo', async () => {
		const response = (await GET(event())) as Response;
		expect(response.status).toBe(302);
		const location = new URL(response.headers.get('location')!);
		expect(location.origin).toBe('https://wa.me');
		const message = location.searchParams.get('text')!;
		expect(message).toContain('Hola Ana Pérez. Te escribimos de Consultorio Frutos');
		expect(message).toContain('Datos para transferir: Alias natalia.frutos');
		expect(message).toContain('Si no la recibimos para esa fecha, el turno se libera automáticamente.');
		expect(message).toContain('Ver tu turno: https://app.test/turno/token-1');
		expect(mocks.openDepositReminder).toHaveBeenCalledWith(expect.anything(), {
			businessId: BUSINESS_ID,
			appointmentId: APPOINTMENT_ID,
			reopen: false
		});
		expect(mocks.filters).toEqual([['business_id', BUSINESS_ID], ['appointment_id', APPOINTMENT_ID]]);
	});

	it('promete la cancelación automática sólo si este turno se cancela solo y el consultorio la tiene encendida', async () => {
		for (const [autoCancel, practice] of [[false, true], [true, false]] as const) {
			mocks.row = { data: depositRow({ auto_cancel: autoCancel }), error: null };
			mocks.loadDepositPolicy.mockResolvedValue({ autoCancelEnabled: practice, transferDetails: null });
			const message = new URL(((await GET(event())) as Response).headers.get('location')!).searchParams.get('text')!;
			expect(message).not.toContain('se libera automáticamente');
			expect(message).not.toContain('Datos para transferir');
		}
	});

	it('en una computadora abre WhatsApp Web', async () => {
		const response = (await GET(event('?dispositivo=desktop'))) as Response;
		expect(new URL(response.headers.get('location')!).origin).toBe('https://web.whatsapp.com');
	});

	it('abrirlo otra vez exige la confirmación, y la base decide', async () => {
		await GET(event('?confirmar=1'));
		expect(mocks.openDepositReminder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reopen: true }));
		mocks.openDepositReminder.mockRejectedValue(new DepositError('DEPOSIT_REMINDER_ALREADY_OPENED'));
		await expect(redirectOf(GET(event()))).resolves.toMatchObject({ status: 303, location: '/odonto/senas?aviso=ya_abierto' });
	});

	it('sin una seña pendiente, sin teléfono o con la persona bloqueada vuelve a la lista sin registrar nada', async () => {
		for (const [data, notice] of [
			[depositRow({ status: 'paid', recorded_at: '2026-11-15T10:00:00.000Z' }), 'no_pendiente'],
			[depositRow({}, { phone_e164: null }), 'sin_telefono'],
			[depositRow({}, { blocked: true }), 'sin_telefono'],
			[null, 'no_encontrado']
		] as const) {
			mocks.row = { data, error: null };
			await expect(redirectOf(GET(event()))).resolves.toMatchObject({ location: `/odonto/senas?aviso=${notice}` });
		}
		expect(mocks.openDepositReminder).not.toHaveBeenCalled();
	});

	it('un identificador mal formado no llega a la base', async () => {
		await expect(redirectOf(GET(event('', 'no-es-uuid')))).resolves.toMatchObject({ location: '/odonto/senas?aviso=no_encontrado' });
		expect(mocks.filters).toEqual([]);
	});

	it('sin poder armar el mensaje no registra la apertura', async () => {
		mocks.loadDepositPolicy.mockRejectedValue(new Error('read failed'));
		await expect(redirectOf(GET(event()))).resolves.toMatchObject({ location: '/odonto/senas?aviso=error' });
		expect(mocks.openDepositReminder).not.toHaveBeenCalled();
		expect(mocks.logServerFailure).toHaveBeenCalled();
	});

	it('una seña resuelta mientras tanto y una falla inesperada vuelven con su aviso', async () => {
		mocks.openDepositReminder.mockRejectedValue(new DepositError('DEPOSIT_NOT_PENDING'));
		await expect(redirectOf(GET(event()))).resolves.toMatchObject({ location: '/odonto/senas?aviso=no_pendiente' });
		mocks.openDepositReminder.mockRejectedValue(new Error('network'));
		await expect(redirectOf(GET(event()))).resolves.toMatchObject({ location: '/odonto/senas?aviso=error' });
		expect(mocks.logServerFailure).toHaveBeenCalled();
	});

	it('quien no opera el consultorio vuelve a la lista sin leer la seña', async () => {
		mocks.resolveActiveBusiness.mockResolvedValue({ business: { id: BUSINESS_ID }, canOperate: false });
		await expect(redirectOf(GET(event()))).resolves.toMatchObject({ location: '/odonto/senas' });
		expect(mocks.filters).toEqual([]);
	});
});

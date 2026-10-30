import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOdontoContext: vi.fn(), from: vi.fn(), rpc: vi.fn(), setAppointmentDeposit: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/business', () => ({ demoBusinessContext: vi.fn() }));
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getOdontoContext }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: vi.fn(async () => ({})) }));
vi.mock('$lib/server/sites/public/booking-integration-flags', () => ({ bookingContextsAvailable: () => false }));
vi.mock('$lib/server/sites/public/booking-integrations', () => ({
	loadAppointmentBookingContext: vi.fn(), loadAppointmentIntakeForPatient: vi.fn()
}));
vi.mock('$lib/server/integrations/public/google-calendar', () => ({ processAppointmentGoogleCalendarSync: vi.fn() }));
vi.mock('$lib/server/integrations/public/push', () => ({ resetPushRemindersForReschedule: vi.fn(), sendReschedulePushNotice: vi.fn() }));
// The real deposit errors and messages; only the database write is replaced.
vi.mock('$lib/server/scheduling/public/deposits', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/scheduling/public/deposits')>()),
	setAppointmentDeposit: mocks.setAppointmentDeposit
}));

const { load, actions } = await import('./+page.server');
const { DepositError } = await import('$lib/server/scheduling/public/deposits');

// A query builder: every chained call returns it, and awaiting it gives `result`.
const query = (result: unknown) => {
	const builder: object = new Proxy({}, {
		get: (_target, key) =>
			key === 'then'
				? (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
				: () => builder
	});
	return builder;
};

const appointmentId = '00000000-0000-4000-8000-0000000000a1';
const appointment = {
	id: appointmentId, business_id: 'business-1', patient_id: 'patient-1', professional_id: 'p1', status: 'confirmed', source: 'manual',
	starts_at: '2026-10-28T13:00:00.000Z', ends_at: '2026-10-28T13:30:00.000Z', confirmation_token: null,
	professional_name_snapshot: 'Profesional Uno', break_minutes_snapshot: 0, patients: { full_name: 'Paciente', phone_e164: null }
};
// A joint appointment: the colleague is the second professional.
const team = [
	{ professional_id: 'p1', position: 0, is_primary: true, professional_name_snapshot: 'Profesional Uno', break_minutes_snapshot: 0 },
	{ professional_id: 'p2', position: 1, is_primary: false, professional_name_snapshot: 'Profesional Dos', break_minutes_snapshot: 0 }
];
const audit = [{ id: 'log-1', user_id: 'user-1', action: 'appointment.created', entity_type: 'appointment', entity_id: appointmentId, metadata: {}, created_at: '2026-10-20T12:00:00.000Z' }];
const failure = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };

const tables = (overrides: Record<string, unknown> = {}) => {
	const results: Record<string, unknown> = {
		appointments: { data: appointment, error: null },
		audit_logs: { data: audit, error: null },
		appointment_professionals: { data: team, error: null },
		message_dispatches: { data: [], error: null },
		...overrides
	};
	mocks.from.mockImplementation((table: string) => query(results[table]));
};

const event = (search = '') =>
	({
		params: { appointmentId },
		locals: { auth: { access_token: 'test-token' } },
		fetch: vi.fn(),
		cookies: { get: vi.fn() },
		url: new URL(`http://localhost/odonto/turnos/${appointmentId}${search}`),
		request: new Request(`http://localhost/odonto/turnos/${appointmentId}`)
	}) as never;

type Detail = { appointment: { professionals: Array<{ professional_id: string }> }; auditLogs: unknown[] | null };

describe('appointment detail load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOdontoContext.mockResolvedValue({
			supabase: { from: mocks.from, rpc: mocks.rpc },
			business: { business: { id: 'business-1', name: 'Consultorio', timezone: 'America/Argentina/Buenos_Aires' }, role: 'owner', access: { canUseBusiness: true } },
			userId: 'user-1'
		});
		mocks.rpc.mockImplementation((name: string) =>
			query(name === 'list_business_users' ? { data: [{ user_id: 'user-1', email: 'owner@example.test' }], error: null } : { data: true, error: null }));
	});

	it('shows the whole team of a joint appointment and its history', async () => {
		tables();
		const result = (await load(event())) as Detail;
		expect(result.appointment.professionals.map((item) => item.professional_id)).toEqual(['p1', 'p2']);
		expect(result.auditLogs).toEqual(audit);
	});

	it('fails explicitly instead of showing a joint appointment as one professional when its team cannot be read', async () => {
		tables({ appointment_professionals: failure });
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
	});

	it('says the history could not be loaded instead of showing it as empty', async () => {
		tables({ audit_logs: failure });
		const result = (await load(event())) as Detail;
		expect(result.auditLogs).toBeNull();
	});

	it('does not read the WhatsApp dispatches the page no longer shows', async () => {
		tables();
		await load(event());
		expect(mocks.from).not.toHaveBeenCalledWith('message_dispatches');
	});

	it('ignores dates in the address that are not real dates', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-21T15:00:00.000Z'));
		try {
			tables();
			const result = (await load(event('?reprogram_date=hoy&from_date=2026-13-01'))) as { reprogramDate: string; fromDate: string };
			expect([result.reprogramDate, result.fromDate]).toEqual(['2026-10-28', '2026-10-28']);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('appointment deposit in the detail', () => {
	const pending = {
		appointment_id: appointmentId, status: 'pending', amount: 40000, currency: 'ARS', request_from: '2026-11-13T03:00:00.000Z',
		due_at: '2026-11-18T13:00:00.000Z', auto_cancel: true, waived_reason: null, recorded_at: null, reminder_opened_at: null,
		expired_at: null, revision: 3
	};
	const withRole = (role: string, canOperate = true) =>
		mocks.getOdontoContext.mockResolvedValue({
			supabase: { from: mocks.from, rpc: mocks.rpc },
			business: { business: { id: 'business-1', name: 'Consultorio', timezone: 'America/Argentina/Buenos_Aires' }, role, canOperate, access: { canUseBusiness: true } },
			userId: 'user-1'
		});
	type DepositDetail = { appointment: Record<string, unknown>; deposit: { cancelsItself: boolean | null; revision: number } | null; canRecordDeposit: boolean };

	beforeEach(() => {
		vi.clearAllMocks();
		withRole('reception');
		mocks.rpc.mockImplementation(() => query({ data: [], error: null }));
	});

	it('shows the deposit, whether it cancels itself, and who records it', async () => {
		tables({ appointments: { data: { ...appointment, status: 'reserved', appointment_deposits: pending }, error: null }, deposit_policies: { data: { auto_cancel_enabled: true }, error: null } });
		const result = (await load(event())) as DepositDetail;
		expect(result.deposit).toMatchObject({ status: 'pending', revision: 3, cancelsItself: true });
		expect(result.canRecordDeposit).toBe(true);
		expect(result.appointment).not.toHaveProperty('appointment_deposits');
	});

	it('with the practice switch off the turn does not cancel itself; unknown is said as unknown', async () => {
		tables({ appointments: { data: { ...appointment, appointment_deposits: pending }, error: null }, deposit_policies: { data: { auto_cancel_enabled: false }, error: null } });
		await expect(load(event())).resolves.toMatchObject({ deposit: { cancelsItself: false } });
		tables({ appointments: { data: { ...appointment, appointment_deposits: pending }, error: null }, deposit_policies: failure });
		await expect(load(event())).resolves.toMatchObject({ deposit: { cancelsItself: null } });
	});

	it('without a deposit reads no policy', async () => {
		tables({ appointments: { data: { ...appointment, appointment_deposits: null }, error: null } });
		await expect(load(event())).resolves.toMatchObject({ deposit: null });
		expect(mocks.from).not.toHaveBeenCalledWith('deposit_policies');
	});

	it('professionals, read-only users and a practice that does not operate do not record deposits', async () => {
		for (const [role, canOperate] of [['professional', true], ['readonly', true], ['owner', false]] as const) {
			withRole(role, canOperate);
			tables({ appointments: { data: { ...appointment, appointment_deposits: pending }, error: null }, deposit_policies: { data: { auto_cancel_enabled: true }, error: null } });
			await expect(load(event())).resolves.toMatchObject({ canRecordDeposit: false });
		}
	});

	const post = (fields: Record<string, string>) =>
		actions.deposit({
			...(event() as object),
			request: new Request(`http://localhost/odonto/turnos/${appointmentId}?/deposit`, { method: 'POST', body: new URLSearchParams(fields) })
		} as never);

	it('records the deposit with the revision the person saw', async () => {
		mocks.setAppointmentDeposit.mockResolvedValue({ status: 'pending', revision: 5, appointmentStatus: 'reserved' });
		await expect(post({ deposit_action: 'pending', expected_revision: '4' })).resolves.toEqual({
			success: true,
			message: 'Se deshizo el registro de la seña. El turno volvió a Reservado.'
		});
		expect(mocks.setAppointmentDeposit).toHaveBeenCalledWith(expect.anything(), {
			businessId: 'business-1', appointmentId, action: 'pending', expectedRevision: 4
		});
	});

	it('an unknown action or a missing revision never reaches the database', async () => {
		await expect(post({ deposit_action: 'borrar', expected_revision: '4' })).resolves.toMatchObject({ status: 400 });
		await expect(post({ deposit_action: 'paid', expected_revision: '' })).resolves.toMatchObject({ status: 400 });
		expect(mocks.setAppointmentDeposit).not.toHaveBeenCalled();
	});

	it('a deposit rule answers with its own status and message', async () => {
		mocks.setAppointmentDeposit.mockRejectedValue(new DepositError('DEPOSIT_FORBIDDEN'));
		await expect(post({ deposit_action: 'paid', expected_revision: '4' })).resolves.toMatchObject({
			status: 403,
			data: { message: 'No tenés permiso para registrar señas en este consultorio.' }
		});
	});
});


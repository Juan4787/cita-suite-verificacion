import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOdontoContext: vi.fn(), from: vi.fn(), rpc: vi.fn() }));

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

const { load } = await import('./+page.server');

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

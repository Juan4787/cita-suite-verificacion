import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getAvailabilitySlots: vi.fn(),
	getOdontoContext: vi.fn(),
	rescheduleAppointment: vi.fn(),
	createSupabaseAdminClient: vi.fn(),
	resetPushRemindersForReschedule: vi.fn(),
	sendReschedulePushNotice: vi.fn(),
	processAppointmentGoogleCalendarSync: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/business', () => ({ demoBusinessContext: vi.fn() }));
vi.mock('$lib/server/availability', () => ({
	getAvailabilitySlots: mocks.getAvailabilitySlots
}));
vi.mock('$lib/server/appointments', () => ({
	getHumanAppointmentErrorMessage: () => 'No pudimos reprogramar el turno.',
	isAppointmentStatus: vi.fn(),
	rescheduleAppointment: mocks.rescheduleAppointment,
	updateAppointmentStatus: vi.fn(),
	updateProfessionalAppointmentStatus: vi.fn()
}));
vi.mock('$lib/server/odonto-context', () => ({
	getOdontoContext: mocks.getOdontoContext
}));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock('$lib/server/google-calendar', () => ({
	processAppointmentGoogleCalendarSync: mocks.processAppointmentGoogleCalendarSync
}));
vi.mock('$lib/server/push', () => ({
	resetPushRemindersForReschedule: mocks.resetPushRemindersForReschedule,
	sendReschedulePushNotice: mocks.sendReschedulePushNotice
}));
vi.mock('$lib/server/reminders', () => ({
	buildAppointmentActivationDelivery: vi.fn(),
	buildArgentineWaMeUrl: vi.fn(),
	buildRescheduleWhatsAppMessage: vi.fn()
}));
vi.mock('$lib/server/messaging', () => ({ publicRescheduleUrl: vi.fn() }));

const { actions } = await import('./+page.server');

const futureDateParts = Object.fromEntries(
	new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)).map((part) => [part.type, part.value])
);
const reprogramDate = `${futureDateParts.year}-${futureDateParts.month}-${futureDateParts.day}`;
const slotStartsAt = `${reprogramDate}T15:00:00.000Z`;

const appointmentResult = {
	data: {
		id: 'appointment-1',
		service_id: 'service-1',
		professional_id: 'professional-1',
		status: 'confirmed',
		ignore_break: false
	},
	error: null
};
const teamResult = {
	data: [{ professional_id: 'professional-1', position: 0 }],
	error: null
};

const query = (result: typeof appointmentResult | typeof teamResult) => {
	const chain: any = {};
	for (const method of ['select', 'eq', 'order']) chain[method] = () => chain;
	chain.maybeSingle = async () => result;
	chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
	return chain;
};

const makeSupabase = () => ({
	from: (table: string) => query(table === 'appointments' ? appointmentResult : teamResult)
});

const callReschedule = () =>
	actions.reschedule({
		request: new Request('https://app.test/odonto/turnos/appointment-1?/reschedule', {
			method: 'POST',
			body: new URLSearchParams({
				slot_starts_at: slotStartsAt,
				reprogram_date: reprogramDate,
				ignore_break: 'false'
			})
		}),
		params: { appointmentId: 'appointment-1' },
		locals: { auth: { access_token: 'token' } },
		fetch: vi.fn(),
		cookies: {} as never
	} as never);

beforeEach(() => {
	vi.clearAllMocks();
	const supabase = makeSupabase();
	mocks.getOdontoContext.mockResolvedValue({
		supabase,
		userId: 'user-1',
		business: {
			canOperate: true,
			business: {
				id: 'business-1',
				timezone: 'America/Argentina/Buenos_Aires'
			}
		}
	});
	mocks.getAvailabilitySlots.mockResolvedValue([
		{
			date: reprogramDate,
			time: '12:00',
			starts_at: slotStartsAt,
			professional_id: 'professional-1'
		}
	]);
	mocks.rescheduleAppointment.mockResolvedValue(undefined);
	mocks.createSupabaseAdminClient.mockResolvedValue({ admin: true });
	mocks.resetPushRemindersForReschedule.mockResolvedValue(1);
	mocks.sendReschedulePushNotice.mockResolvedValue({ configured: true, sent: 1, failed: 0, revoked: 0 });
	mocks.processAppointmentGoogleCalendarSync.mockResolvedValue(undefined);
});

describe('reprogramación desde el detalle de Agenda', () => {
	it('cambia el horario, reinicia avisos y envía el aviso inmediato antes de volver al detalle', async () => {
		await expect(callReschedule()).rejects.toMatchObject({
			status: 303,
			location:
				`/odonto/turnos/appointment-1?from_date=${reprogramDate}&reprogram_date=${reprogramDate}&rescheduled=1`
		});

		expect(mocks.rescheduleAppointment).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				businessId: 'business-1',
				appointmentId: 'appointment-1',
				startsAt: new Date(slotStartsAt)
			})
		);
		expect(mocks.resetPushRemindersForReschedule).toHaveBeenCalledOnce();
		expect(mocks.sendReschedulePushNotice).toHaveBeenCalledWith(
			{ admin: true },
			{ businessId: 'business-1', appointmentId: 'appointment-1' }
		);
		expect(mocks.processAppointmentGoogleCalendarSync).toHaveBeenCalledWith(
			{ admin: true },
			'appointment-1',
			expect.any(Function)
		);
	});

	it('un refuerzo de reseteo fallido no impide el aviso inmediato del horario nuevo', async () => {
		mocks.resetPushRemindersForReschedule.mockRejectedValueOnce(new Error('reset unavailable'));

		await expect(callReschedule()).rejects.toMatchObject({ status: 303 });
		expect(mocks.sendReschedulePushNotice).toHaveBeenCalledOnce();
	});

	it('un fallo del proveedor de avisos no revierte la reprogramación confirmada', async () => {
		mocks.sendReschedulePushNotice.mockRejectedValueOnce(new Error('push unavailable'));

		await expect(callReschedule()).rejects.toMatchObject({ status: 303 });
		expect(mocks.rescheduleAppointment).toHaveBeenCalledOnce();
		expect(mocks.processAppointmentGoogleCalendarSync).toHaveBeenCalledOnce();
	});
});

// Auditoría 2026-07-02: escenarios de negocio del motor de disponibilidad.
// - Un turno tomado oculta el horario SOLO para ese profesional.
// - Los buffers (descanso entre sesiones) se respetan contra los rangos de bloqueo.
// - La duración del slot es exactamente la configurada en el servicio.
// - La anticipación mínima del negocio aplica a la reserva pública, no al panel.
// Las fechas se computan relativas a hoy para que la suite no caduque.
import { describe, expect, it } from 'vitest';
import { getAvailabilitySlots, zonedDateTimeToUtc } from './availability';

const TIMEZONE = 'America/Argentina/Cordoba';

const business = {
	id: 'biz-1',
	timezone: TIMEZONE,
	is_active: true,
	public_booking_enabled: true,
	min_booking_notice_minutes: 0,
	max_booking_days_ahead: 60
};

const localDateAhead = (daysAhead: number) =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000));

const weekdayOf = (date: string) => {
	const label = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(
		zonedDateTimeToUtc(date, '12:00', TIMEZONE)
	);
	return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[label as 'Sun'];
};

// Fecha de trabajo ~10 días adelante (dentro de max_booking_days_ahead).
const DATE = localDateAhead(10);
const WEEKDAY = weekdayOf(DATE);
const atLocal = (time: string) => zonedDateTimeToUtc(DATE, time, TIMEZONE).toISOString();

type MockData = {
	service: Record<string, unknown>;
	assignments: unknown[];
	rules: unknown[];
	exceptions?: unknown[];
	appointments?: unknown[];
};

const queryBuilder = (data: unknown) => {
	const builder: Record<string, unknown> = {};
	for (const method of ['eq', 'in', 'lt', 'gt', 'neq']) {
		builder[method] = () => builder;
	}
	builder.maybeSingle = async () => ({ data, error: null });
	(builder as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
		resolve({ data, error: null });
	return builder;
};

const supabaseFor = (input: MockData) => ({
	from: (table: string) => ({
		select: () => {
			if (table === 'services') return queryBuilder(input.service);
			if (table === 'professional_services') return queryBuilder(input.assignments);
			if (table === 'availability_rules') return queryBuilder(input.rules);
			if (table === 'availability_exceptions') return queryBuilder(input.exceptions ?? []);
			if (table === 'appointment_professionals') return queryBuilder(input.appointments ?? []);
			return queryBuilder([]);
		}
	})
});

const professional = (id: string, name: string) => ({
	professional_id: id,
	professionals: { id, name, is_public: true, is_active: true }
});

const rule = (professionalId: string, start: string, end: string, step = 60) => ({
	id: `rule-${professionalId}-${start}`,
	professional_id: professionalId,
	weekday: WEEKDAY,
	start_time: start,
	end_time: end,
	slot_interval_minutes: step,
	is_active: true
});

const service = (overrides: Record<string, unknown> = {}) => ({
	id: 'svc-1',
	business_id: business.id,
	name: 'Consulta',
	duration_minutes: 60,
	buffer_before_minutes: 0,
	buffer_after_minutes: 0,
	is_public: true,
	is_active: true,
	...overrides
});

const timesFor = (slots: Array<{ professional_id: string; time: string }>, professionalId: string) =>
	slots.filter((slot) => slot.professional_id === professionalId).map((slot) => slot.time);

describe('auditoría disponibilidad: turno tomado por profesional', () => {
	it('oculta 16:00 solo para el profesional con turno reservado; el otro lo sigue ofreciendo', async () => {
		const slots = await getAvailabilitySlots(
			supabaseFor({
				service: service(),
				assignments: [professional('pro-1', 'Dra. Uno'), professional('pro-2', 'Dr. Dos')],
				rules: [rule('pro-1', '15:00', '18:00'), rule('pro-2', '15:00', '18:00')],
				appointments: [
					{
						id: 'appt-1',
						professional_id: 'pro-1',
						blocking_starts_at: atLocal('16:00'),
						blocking_ends_at: atLocal('17:00')
					}
				]
			}) as never,
			{ business: business as never, serviceId: 'svc-1', fromDate: DATE, toDate: DATE, publicOnly: true }
		);

		expect(timesFor(slots, 'pro-1')).toEqual(['15:00', '17:00']);
		expect(timesFor(slots, 'pro-2')).toEqual(['15:00', '16:00', '17:00']);
	});

	it('respeta el buffer de descanso: no ofrece el horario pegado al bloqueo del turno anterior', async () => {
		const slots = await getAvailabilitySlots(
			supabaseFor({
				service: service({ buffer_after_minutes: 15 }),
				assignments: [professional('pro-1', 'Dra. Uno')],
				rules: [rule('pro-1', '15:00', '19:00')],
				appointments: [
					{
						id: 'appt-1',
						professional_id: 'pro-1',
						// Turno 15:00–16:00 local + 15 min de buffer ya aplicados por el trigger
						blocking_starts_at: atLocal('15:00'),
						blocking_ends_at: atLocal('16:15')
					}
				]
			}) as never,
			{ business: business as never, serviceId: 'svc-1', fromDate: DATE, toDate: DATE, publicOnly: true }
		);

		// 15:00 choca con el turno; 16:00 invade su buffer. 16:15 es la primera
		// disponibilidad real y se ofrece aunque caiga fuera de la grilla; 18:00 no
		// entra porque su propio buffer sale de la regla.
		expect(timesFor(slots, 'pro-1')).toEqual(['16:15', '17:00']);
	});

	it('los slots duran exactamente lo configurado en el servicio', async () => {
		const slots = await getAvailabilitySlots(
			supabaseFor({
				service: service({ duration_minutes: 45 }),
				assignments: [professional('pro-1', 'Dra. Uno')],
				rules: [rule('pro-1', '15:00', '17:00', 30)],
				appointments: []
			}) as never,
			{ business: business as never, serviceId: 'svc-1', fromDate: DATE, toDate: DATE, publicOnly: true }
		);

		expect(slots.length).toBeGreaterThan(0);
		for (const slot of slots) {
			const minutes = (new Date(slot.ends_at).getTime() - new Date(slot.starts_at).getTime()) / 60_000;
			expect(minutes).toBe(45);
		}
		// Con regla 15:00–17:00 cada 30': 15:00, 15:30, 16:00 y 16:15 no (no entra 45').
		expect(timesFor(slots, 'pro-1')).toEqual(['15:00', '15:30', '16:00']);
	});
});

describe('auditoría disponibilidad: anticipación mínima del negocio', () => {
	const businessWithNotice = {
		...business,
		// 15 días de anticipación: la fecha de trabajo (10 días adelante) queda adentro.
		min_booking_notice_minutes: 15 * 24 * 60
	};
	const mockData = (): MockData => ({
		service: service(),
		assignments: [professional('pro-1', 'Dra. Uno')],
		rules: [rule('pro-1', '15:00', '18:00')],
		appointments: []
	});

	it('oculta al público los horarios con menos anticipación que la configurada', async () => {
		const slots = await getAvailabilitySlots(supabaseFor(mockData()) as never, {
			business: businessWithNotice as never,
			serviceId: 'svc-1',
			fromDate: DATE,
			toDate: DATE,
			publicOnly: true
		});
		expect(slots).toEqual([]);
	});

	it('no afecta al panel: recepción sigue viendo esos horarios', async () => {
		const slots = await getAvailabilitySlots(supabaseFor(mockData()) as never, {
			business: businessWithNotice as never,
			serviceId: 'svc-1',
			fromDate: DATE,
			toDate: DATE,
			publicOnly: false
		});
		expect(timesFor(slots, 'pro-1')).toEqual(['15:00', '16:00', '17:00']);
	});
});

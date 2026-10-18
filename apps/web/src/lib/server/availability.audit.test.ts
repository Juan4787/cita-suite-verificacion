// Auditoría 2026-07-02: escenarios de negocio del motor de disponibilidad.
// - Un turno tomado oculta el horario SOLO para ese profesional.
// - Los buffers (descanso entre sesiones) se respetan contra los rangos de bloqueo.
// - La duración del slot es exactamente la configurada en el servicio.
// - La anticipación mínima del negocio aplica a la reserva pública, no al panel.
// Las fechas se computan relativas a hoy para que la suite no caduque.
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { readRecord, readText, readFiniteNumber } from '$lib/contracts/json';
import { getAvailabilitySlots, zonedDateTimeToUtc } from '$lib/server/scheduling/public/availability';

const TIMEZONE = 'America/Argentina/Cordoba';

const business = {
	id: '00000000-0000-4000-8000-000000000001',
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

const supabaseFor = (input: MockData, settings = business) => createClient<CitaDatabase>('https://synthetic.example.test', 'synthetic-key', {
 auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
 global: { fetch: async (url, init) => {
  const params = readRecord(JSON.parse(String(init?.body)), 'synthetic.rpcBody');
  const scope = params.p_public ? 'public' : 'internal';
  const professionals = input.assignments.map(value => {
   const row = readRecord(readRecord(value, 'synthetic.assignment').professionals, 'synthetic.professional');
   return { ...row, id: readText(row.id, 'synthetic.professionalId'), sort_order: 0, specialty: null, avatar_url: null };
  });
  const blocks = (input.appointments ?? []).map((value, i) => {
   const row = readRecord(value, 'synthetic.block');
   const start = readText(row.blocking_starts_at, 'synthetic.start');
   const end = readText(row.blocking_ends_at, 'synthetic.end');
   return { ...row, id: `00000000-0000-4000-8000-${String(300 + i).padStart(12, '0')}`,
    appointment_id: `00000000-0000-4000-8000-${String(400 + i).padStart(12, '0')}`,
    starts_at: new Date(Date.parse(start) + readFiniteNumber(input.service.buffer_before_minutes, 'synthetic.before') * 60000).toISOString(),
    ends_at: new Date(Date.parse(end) - readFiniteNumber(input.service.buffer_after_minutes, 'synthetic.after') * 60000).toISOString(),
    base_blocking_starts_at: start, base_blocking_ends_at: end };
  });
  const exceptions = (input.exceptions ?? []).map((value, i) => ({ ...readRecord(value, 'synthetic.exception'),
   id: `00000000-0000-4000-8000-${String(200 + i).padStart(12, '0')}`, allowed_service_ids: [] }));
  const payload = String(url).endsWith('get_availability_catalog') ? {
   schema_version: 2, business_id: business.id, scope, configuration_revision: 1, generated_at: new Date().toISOString(), business: settings,
   services: [{ ...input.service, sort_order: 0, description: null, price_label: null }], professionals,
   assignments: professionals.map(row => ({ service_id: input.service.id, professional_id: row.id })),
   rules: input.rules.map((value, i) => ({ ...readRecord(value, 'synthetic.rule'),
    id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`, service_scope: 'all', allowed_service_ids: [], break_minutes: 0 }))
  } : { schema_version: 2, complete: true, business_id: business.id, scope, configuration_revision: 1, generated_at: new Date().toISOString(),
   from_date: params.p_from_date, to_date: params.p_to_date, professional_ids: params.p_professional_ids,
   counts: { blocks: blocks.length, exceptions: exceptions.length }, blocks, exceptions };
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
 } }
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
	id: '00000000-0000-4000-8000-000000000002',
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
				assignments: [professional('00000000-0000-4000-8000-000000000003', 'Dra. Uno'), professional('00000000-0000-4000-8000-000000000004', 'Dr. Dos')],
				rules: [rule('00000000-0000-4000-8000-000000000003', '15:00', '18:00'), rule('00000000-0000-4000-8000-000000000004', '15:00', '18:00')],
				appointments: [
					{
						id: 'appt-1',
						professional_id: '00000000-0000-4000-8000-000000000003',
						blocking_starts_at: atLocal('16:00'),
						blocking_ends_at: atLocal('17:00')
					}
				]
			}),
			{ business, serviceId: '00000000-0000-4000-8000-000000000002', fromDate: DATE, toDate: DATE, publicOnly: true }
		);

		expect(timesFor(slots, '00000000-0000-4000-8000-000000000003')).toEqual(['15:00', '17:00']);
		expect(timesFor(slots, '00000000-0000-4000-8000-000000000004')).toEqual(['15:00', '16:00', '17:00']);
	});

	it('respeta el buffer de descanso: no ofrece el horario pegado al bloqueo del turno anterior', async () => {
		const slots = await getAvailabilitySlots(
			supabaseFor({
				service: service({ buffer_after_minutes: 15 }),
				assignments: [professional('00000000-0000-4000-8000-000000000003', 'Dra. Uno')],
				rules: [rule('00000000-0000-4000-8000-000000000003', '15:00', '19:00')],
				appointments: [
					{
						id: 'appt-1',
						professional_id: '00000000-0000-4000-8000-000000000003',
						// Turno 15:00–16:00 local + 15 min de buffer ya aplicados por el trigger
						blocking_starts_at: atLocal('15:00'),
						blocking_ends_at: atLocal('16:15')
					}
				]
			}),
			{ business, serviceId: '00000000-0000-4000-8000-000000000002', fromDate: DATE, toDate: DATE, publicOnly: true }
		);

		// 15:00 choca con el turno; 16:00 invade su buffer. 16:15 es la primera
		// disponibilidad real y se ofrece aunque caiga fuera de la grilla; 18:00 no
		// entra porque su propio buffer sale de la regla.
		expect(timesFor(slots, '00000000-0000-4000-8000-000000000003')).toEqual(['16:15', '17:00']);
	});

	it('los slots duran exactamente lo configurado en el servicio', async () => {
		const slots = await getAvailabilitySlots(
			supabaseFor({
				service: service({ duration_minutes: 45 }),
				assignments: [professional('00000000-0000-4000-8000-000000000003', 'Dra. Uno')],
				rules: [rule('00000000-0000-4000-8000-000000000003', '15:00', '17:00', 30)],
				appointments: []
			}),
			{ business, serviceId: '00000000-0000-4000-8000-000000000002', fromDate: DATE, toDate: DATE, publicOnly: true }
		);

		expect(slots.length).toBeGreaterThan(0);
		for (const slot of slots) {
			const minutes = (new Date(slot.ends_at).getTime() - new Date(slot.starts_at).getTime()) / 60_000;
			expect(minutes).toBe(45);
		}
		// Con regla 15:00–17:00 cada 30': 15:00, 15:30, 16:00 y 16:15 no (no entra 45').
		expect(timesFor(slots, '00000000-0000-4000-8000-000000000003')).toEqual(['15:00', '15:30', '16:00']);
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
		assignments: [professional('00000000-0000-4000-8000-000000000003', 'Dra. Uno')],
		rules: [rule('00000000-0000-4000-8000-000000000003', '15:00', '18:00')],
		appointments: []
	});

	it('oculta al público los horarios con menos anticipación que la configurada', async () => {
		const slots = await getAvailabilitySlots(supabaseFor(mockData(), businessWithNotice), {
			business: businessWithNotice,
			serviceId: '00000000-0000-4000-8000-000000000002',
			fromDate: DATE,
			toDate: DATE,
			publicOnly: true
		});
		expect(slots).toEqual([]);
	});

	it('no afecta al panel: recepción sigue viendo esos horarios', async () => {
		const slots = await getAvailabilitySlots(supabaseFor(mockData(), businessWithNotice), {
			business: businessWithNotice,
			serviceId: '00000000-0000-4000-8000-000000000002',
			fromDate: DATE,
			toDate: DATE,
			publicOnly: false
		});
		expect(timesFor(slots, '00000000-0000-4000-8000-000000000003')).toEqual(['15:00', '16:00', '17:00']);
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { readRecord } from '$lib/contracts/json';
import {
	addMinutes,
	calculateAvailabilitySlots,
	getAvailabilitySlots,
	overlaps,
	zonedDateTimeToUtc
} from '$lib/server/scheduling/public/availability';

const business = {
	id: '00000000-0000-4000-8000-000000000001',
	timezone: 'America/Argentina/Cordoba',
	is_active: true,
	public_booking_enabled: true,
	min_booking_notice_minutes: 0,
	max_booking_days_ahead: 30
};

const supabaseForAvailability = (input: { professionalName: string; rules: unknown[]; exceptions?: unknown[] }) => {
 const pro = '00000000-0000-4000-8000-000000000003';
 const service = '00000000-0000-4000-8000-000000000002';
 return createClient<CitaDatabase>('https://synthetic.example.test', 'synthetic-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (url, init) => {
   const params = readRecord(JSON.parse(String(init?.body)), 'synthetic.rpcBody');
   const scope = params.p_public ? 'public' : 'internal';
   const visible = scope === 'internal' || Boolean(input.professionalName.trim());
   const payload = String(url).endsWith('get_availability_catalog') ? {
    schema_version: 2, business_id: business.id, scope, configuration_revision: 1, generated_at: new Date().toISOString(), business,
    services: [{ id: service, business_id: business.id, name: 'Consulta', duration_minutes: 30,
     buffer_before_minutes: 0, buffer_after_minutes: 0, is_public: true, is_active: true, sort_order: 0, description: null, price_label: null }],
    professionals: visible ? [{ id: pro, name: input.professionalName, is_public: true, is_active: true, sort_order: 0, specialty: null, avatar_url: null }] : [],
    assignments: visible ? [{ service_id: service, professional_id: pro }] : [],
    rules: visible ? input.rules.map((value, i) => ({ ...readRecord(value, 'synthetic.rule'),
     id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`, service_scope: 'all', allowed_service_ids: [], break_minutes: 0 })) : []
   } : {
    schema_version: 2, complete: true, business_id: business.id, scope, configuration_revision: 1, generated_at: new Date().toISOString(),
    from_date: params.p_from_date, to_date: params.p_to_date, professional_ids: params.p_professional_ids,
    counts: { blocks: 0, exceptions: input.exceptions?.length ?? 0 }, blocks: [],
    exceptions: (input.exceptions ?? []).map((value, i) => ({ ...readRecord(value, 'synthetic.exception'),
     id: `00000000-0000-4000-8000-${String(200 + i).padStart(12, '0')}`, allowed_service_ids: [] }))
   };
   return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  } }
 });
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-20T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('availability core', () => {
	it('detecta solapamientos con rango semiabierto', () => {
		const base = new Date('2026-05-13T10:00:00.000Z');
		expect(overlaps(base, addMinutes(base, 60), addMinutes(base, 15), addMinutes(base, 45))).toBe(true);
		expect(overlaps(base, addMinutes(base, 60), addMinutes(base, 60), addMinutes(base, 90))).toBe(false);
		expect(overlaps(base, addMinutes(base, 60), addMinutes(base, -30), base)).toBe(false);
	});

	it('convierte fecha/hora de Argentina a UTC sin depender del timezone del servidor', () => {
		const utc = zonedDateTimeToUtc('2026-05-13', '09:30', 'America/Argentina/Cordoba');
		expect(utc.toISOString()).toBe('2026-05-13T12:30:00.000Z');
	});

	it('el atajo de primera disponibilidad conserva el horario más temprano aunque las reglas estén desordenadas', () => {
		const slots = calculateAvailabilitySlots({
			business: business,
			service: {
				id: '00000000-0000-4000-8000-000000000002',
				business_id: business.id,
				name: 'Consulta',
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			},
			professionals: [{ id: '00000000-0000-4000-8000-000000000003', name: 'Dra. Uno', is_public: true, is_active: true }],
			rules: [
				{
					id: 'late',
					professional_id: '00000000-0000-4000-8000-000000000003',
					weekday: 1,
					start_time: '11:00',
					end_time: '12:00',
					slot_interval_minutes: 30,
					is_active: true
				},
				{
					id: 'early',
					professional_id: '00000000-0000-4000-8000-000000000003',
					weekday: 1,
					start_time: '09:00',
					end_time: '10:00',
					slot_interval_minutes: 30,
					is_active: true
				}
			],
			exceptions: [],
			blocks: [],
			fromDate: '2026-06-22',
			toDate: '2026-06-22',
			publicOnly: true,
			now: new Date('2026-06-20T12:00:00.000Z'),
			maxSlots: 1
		});

		expect(slots.map((slot) => slot.time)).toEqual(['09:00']);
	});

	it('el límite global conserva el horario más temprano entre varios profesionales', () => {
		const slots = calculateAvailabilitySlots({
			business: business,
			service: {
				id: '00000000-0000-4000-8000-000000000002',
				business_id: business.id,
				name: 'Consulta',
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			},
			professionals: [
				{ id: 'pro-tarde', name: 'Dra. Tarde', is_public: true, is_active: true },
				{ id: 'pro-temprano', name: 'Dr. Temprano', is_public: true, is_active: true }
			],
			rules: [
				{
					id: 'late',
					professional_id: 'pro-tarde',
					weekday: 1,
					start_time: '11:00',
					end_time: '12:00',
					slot_interval_minutes: 30,
					is_active: true
				},
				{
					id: 'early',
					professional_id: 'pro-temprano',
					weekday: 1,
					start_time: '09:00',
					end_time: '10:00',
					slot_interval_minutes: 30,
					is_active: true
				}
			],
			exceptions: [],
			blocks: [],
			fromDate: '2026-06-22',
			toDate: '2026-06-22',
			publicOnly: true,
			now: new Date('2026-06-20T12:00:00.000Z'),
			maxSlots: 1
		});

		expect(slots).toHaveLength(1);
		expect(slots[0]).toMatchObject({ time: '09:00', professional_id: 'pro-temprano' });
	});

	it('no genera slots públicos para profesionales sin nombre visible', async () => {
		const slots = await getAvailabilitySlots(
			supabaseForAvailability({
				professionalName: '   ',
				rules: [
					{
						id: 'rule-1',
						professional_id: '00000000-0000-4000-8000-000000000003',
						weekday: 1,
						start_time: '09:00',
						end_time: '10:00',
						slot_interval_minutes: 30,
						is_active: true
					}
				]
			}),
			{
				business: business,
				serviceId: '00000000-0000-4000-8000-000000000002',
				fromDate: '2026-06-22',
				toDate: '2026-06-22',
				publicOnly: true
			}
		);

		expect(slots).toEqual([]);
	});

	it('no genera slots públicos para profesionales sin horario semanal activo', async () => {
		const slots = await getAvailabilitySlots(
			supabaseForAvailability({
				professionalName: 'Dra. Uno',
				rules: [],
				exceptions: [
					{
						id: 'exc-1',
						professional_id: '00000000-0000-4000-8000-000000000003',
						starts_at: '2026-06-22T12:00:00.000Z',
						ends_at: '2026-06-22T13:00:00.000Z',
						type: 'extra_available'
					}
				]
			}),
			{
				business: business,
				serviceId: '00000000-0000-4000-8000-000000000002',
				fromDate: '2026-06-22',
				toDate: '2026-06-22',
				publicOnly: true
			}
		);

		expect(slots).toEqual([]);
	});

	it('bloquea todos los días incluidos en una ausencia de varias fechas', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-20T12:00:00.000Z'));
		try {
			const rules = [1, 2, 3, 4, 5].map((weekday) => ({
				id: `rule-${weekday}`,
				professional_id: '00000000-0000-4000-8000-000000000003',
				weekday,
				start_time: '09:00',
				end_time: '10:00',
				slot_interval_minutes: 30,
				is_active: true
			}));
			const slots = await getAvailabilitySlots(
				supabaseForAvailability({
					professionalName: 'Dra. Uno',
					rules,
					exceptions: [
						{
							id: 'vacaciones-1',
							professional_id: '00000000-0000-4000-8000-000000000003',
							starts_at: '2026-06-22T03:00:00.000Z',
							ends_at: '2026-06-25T03:00:00.000Z',
							type: 'blocked'
						}
					]
				}),
				{
					business: business,
					serviceId: '00000000-0000-4000-8000-000000000002',
					fromDate: '2026-06-22',
					toDate: '2026-06-26'
				}
			);

			expect(slots.map((slot) => slot.date)).toEqual([
				'2026-06-25',
				'2026-06-25',
				'2026-06-26',
				'2026-06-26'
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('ofrece la primera hora exacta después de un descanso de 23 minutos', () => {
		const slots = calculateAvailabilitySlots({
			business: business,
			service: {
				id: '00000000-0000-4000-8000-000000000002',
				business_id: business.id,
				name: 'Consulta',
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			},
			professionals: [{ id: '00000000-0000-4000-8000-000000000003', name: 'Dra. Uno', is_public: true, is_active: true }],
			rules: [
				{
					id: 'rule-1',
					professional_id: '00000000-0000-4000-8000-000000000003',
					weekday: 1,
					start_time: '09:00',
					end_time: '12:00',
					slot_interval_minutes: 15,
					break_minutes: 23,
					is_active: true
				}
			],
			exceptions: [],
			blocks: [
				{
					id: 'allocation-1',
					appointment_id: 'appointment-1',
					professional_id: '00000000-0000-4000-8000-000000000003',
					starts_at: '2026-06-22T12:00:00.000Z',
					ends_at: '2026-06-22T12:30:00.000Z',
					base_blocking_starts_at: '2026-06-22T12:00:00.000Z',
					base_blocking_ends_at: '2026-06-22T12:30:00.000Z',
					blocking_starts_at: '2026-06-22T12:00:00.000Z',
					blocking_ends_at: '2026-06-22T12:53:00.000Z'
				}
			],
			fromDate: '2026-06-22',
			toDate: '2026-06-22',
			now: new Date('2026-06-20T12:00:00.000Z')
		});

		expect(slots[0]?.time).toBe('09:53');
		expect(slots.some((slot) => slot.time === '09:45')).toBe(false);
	});

	it('permite que el último turno termine al cierre aunque el descanso continúe fuera de la jornada', () => {
		const slots = calculateAvailabilitySlots({
			business: business,
			service: {
				id: '00000000-0000-4000-8000-000000000002',
				business_id: business.id,
				name: 'Consulta',
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			},
			professionals: [{ id: '00000000-0000-4000-8000-000000000003', name: 'Dra. Uno', is_public: true, is_active: true }],
			rules: [
				{
					id: 'rule-1',
					professional_id: '00000000-0000-4000-8000-000000000003',
					weekday: 1,
					start_time: '09:00',
					end_time: '10:00',
					slot_interval_minutes: 15,
					break_minutes: 23,
					is_active: true
				}
			],
			exceptions: [],
			blocks: [],
			fromDate: '2026-06-22',
			toDate: '2026-06-22',
			now: new Date('2026-06-20T12:00:00.000Z')
		});

		expect(slots.map((slot) => slot.time)).toContain('09:30');
	});

	it('permite ignorar el descanso manualmente sin ignorar la duración real', () => {
		const slots = calculateAvailabilitySlots({
			business: business,
			service: {
				id: '00000000-0000-4000-8000-000000000002',
				business_id: business.id,
				name: 'Consulta',
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			},
			professionals: [{ id: '00000000-0000-4000-8000-000000000003', name: 'Dra. Uno', is_public: true, is_active: true }],
			rules: [
				{
					id: 'rule-1',
					professional_id: '00000000-0000-4000-8000-000000000003',
					weekday: 1,
					start_time: '09:00',
					end_time: '12:00',
					slot_interval_minutes: 15,
					break_minutes: 23,
					is_active: true
				}
			],
			exceptions: [],
			blocks: [
				{
					id: 'allocation-1',
					professional_id: '00000000-0000-4000-8000-000000000003',
					base_blocking_starts_at: '2026-06-22T12:00:00.000Z',
					base_blocking_ends_at: '2026-06-22T12:30:00.000Z',
					blocking_starts_at: '2026-06-22T12:00:00.000Z',
					blocking_ends_at: '2026-06-22T12:53:00.000Z'
				}
			],
			fromDate: '2026-06-22',
			toDate: '2026-06-22',
			ignoreBreak: true,
			now: new Date('2026-06-20T12:00:00.000Z')
		});

		expect(slots[0]?.time).toBe('09:30');
		expect(slots.some((slot) => slot.time === '09:15')).toBe(false);
	});

	it('inicia un turno conjunto cuando el último integrante del equipo queda disponible', () => {
		const slots = calculateAvailabilitySlots({
			business: business,
			service: {
				id: '00000000-0000-4000-8000-000000000002',
				business_id: business.id,
				name: 'Cirugía',
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			},
			professionals: [
				{ id: '00000000-0000-4000-8000-000000000003', name: 'Dra. Uno', is_public: true, is_active: true },
				{ id: 'pro-2', name: 'Dr. Dos', is_public: true, is_active: true }
			],
			rules: [
				{
					id: 'rule-1',
					professional_id: '00000000-0000-4000-8000-000000000003',
					weekday: 1,
					start_time: '09:00',
					end_time: '12:00',
					slot_interval_minutes: 15,
					break_minutes: 0,
					is_active: true
				},
				{
					id: 'rule-2',
					professional_id: 'pro-2',
					weekday: 1,
					start_time: '09:23',
					end_time: '12:00',
					slot_interval_minutes: 15,
					break_minutes: 0,
					is_active: true
				}
			],
			exceptions: [],
			blocks: [],
			fromDate: '2026-06-22',
			toDate: '2026-06-22',
			requiredProfessionalIds: ['00000000-0000-4000-8000-000000000003', 'pro-2'],
			now: new Date('2026-06-20T12:00:00.000Z')
		});

		expect(slots[0]).toMatchObject({
			time: '09:23',
			professional_ids: ['00000000-0000-4000-8000-000000000003', 'pro-2'],
			professional_names: ['Dra. Uno', 'Dr. Dos'],
			is_joint: true
		});
	});

	it('puede resumir un único horario común por día sin omitir fechas disponibles', () => {
		const slots = calculateAvailabilitySlots({
			business: business,
			service: {
				id: '00000000-0000-4000-8000-000000000002',
				business_id: business.id,
				name: 'Cirugía',
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			},
			professionals: [
				{ id: '00000000-0000-4000-8000-000000000003', name: 'Dra. Uno', is_public: true, is_active: true },
				{ id: 'pro-2', name: 'Dr. Dos', is_public: true, is_active: true }
			],
			rules: [1, 2].flatMap((weekday) =>
				['00000000-0000-4000-8000-000000000003', 'pro-2'].map((professionalId) => ({
					id: `${professionalId}-${weekday}`,
					professional_id: professionalId,
					weekday,
					start_time: professionalId === '00000000-0000-4000-8000-000000000003' ? '09:00' : '09:23',
					end_time: '12:00',
					slot_interval_minutes: 15,
					break_minutes: 0,
					is_active: true
				}))
			),
			exceptions: [],
			blocks: [],
			fromDate: '2026-06-22',
			toDate: '2026-06-23',
			requiredProfessionalIds: ['00000000-0000-4000-8000-000000000003', 'pro-2'],
			now: new Date('2026-06-20T12:00:00.000Z'),
			maxSlotsPerDate: 1
		});

		expect(slots.map((slot) => `${slot.date} ${slot.time}`)).toEqual([
			'2026-06-22 09:23',
			'2026-06-23 09:23'
		]);
		expect(slots.every((slot) => slot.is_joint)).toBe(true);
	});

	it('elimina el horario conjunto si uno solo de los profesionales está ocupado', () => {
		const baseInput = {
			business: business,
			service: {
				id: '00000000-0000-4000-8000-000000000002',
				business_id: business.id,
				name: 'Cirugía',
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			},
			professionals: [
				{ id: '00000000-0000-4000-8000-000000000003', name: 'Dra. Uno', is_public: true, is_active: true },
				{ id: 'pro-2', name: 'Dr. Dos', is_public: true, is_active: true }
			],
			rules: ['00000000-0000-4000-8000-000000000003', 'pro-2'].map((professionalId) => ({
				id: `rule-${professionalId}`,
				professional_id: professionalId,
				weekday: 1,
				start_time: '09:00',
				end_time: '12:00',
				slot_interval_minutes: 15,
				break_minutes: 0,
				is_active: true
			})),
			exceptions: [],
			fromDate: '2026-06-22',
			toDate: '2026-06-22',
			requiredProfessionalIds: ['00000000-0000-4000-8000-000000000003', 'pro-2'],
			now: new Date('2026-06-20T12:00:00.000Z')
		};
		const slots = calculateAvailabilitySlots({
			...baseInput,
			blocks: [
				{
					id: 'allocation-1',
					professional_id: 'pro-2',
					blocking_starts_at: '2026-06-22T12:00:00.000Z',
					blocking_ends_at: '2026-06-22T12:30:00.000Z'
				}
			]
		});

		expect(slots.some((slot) => slot.time === '09:00')).toBe(false);
		expect(slots[0]?.time).toBe('09:30');
	});
});

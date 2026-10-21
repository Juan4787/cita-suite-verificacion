import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { readRecord } from '$lib/contracts/json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	assertPublicBookingPatientPolicy,
	addDaysToDateString,
	canUsePublicBusiness,
	clearPublicBookingScanCache,
	createPublicBooking,
	getPublicBookingErrorCode,
	getPublicBookingErrorMessage,
	loadPublicBookingState,
	PUBLIC_BOOKING_ERROR_MESSAGES,
	summarizeSlotsByDate,
	todayForBusiness,
	verifyTurnstileIfConfigured
} from '$lib/server/scheduling/public/public-booking';
import type { AvailabilitySlot } from '$lib/server/scheduling/public/availability';

describe('Turnstile response contract', () => {
	it.each([null, [], {}, { success: false }, { success: 'true' }, { success: 1 }])(
		'rejects a response without an explicit boolean success: %j',
		async (payload) => {
			const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
			await expect(verifyTurnstileIfConfigured({
				secret: 'synthetic-secret', token: 'synthetic-token', fetchImpl
			})).rejects.toThrow('PUBLIC_CAPTCHA_FAILED');
		}
	);

	it('accepts only a successful HTTP response with boolean success', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true }));
		await expect(verifyTurnstileIfConfigured({
			secret: 'synthetic-secret', token: 'synthetic-token', fetchImpl
		})).resolves.toBeUndefined();
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://challenges.cloudflare.com/turnstile/v0/siteverify',
			expect.objectContaining({ method: 'POST', body: expect.any(URLSearchParams) })
		);
		fetchImpl.mockResolvedValue(Response.json({ success: true }, { status: 503 }));
		await expect(verifyTurnstileIfConfigured({
			secret: 'synthetic-secret', token: 'synthetic-token', fetchImpl
		})).rejects.toThrow('PUBLIC_CAPTCHA_FAILED');
	});
});

const {
	createJointAppointmentMock,
	createManualAppointmentMock,
	findAppointmentCreationReplayMock,
	getAvailabilitySlotsMock
} = vi.hoisted(() => ({
	createJointAppointmentMock: vi.fn(),
	createManualAppointmentMock: vi.fn(),
	findAppointmentCreationReplayMock: vi.fn(),
	getAvailabilitySlotsMock: vi.fn()
}));

vi.mock('$lib/server/scheduling/public/availability', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/server/scheduling/public/availability')>();
	return { ...original, getAvailabilitySlots: getAvailabilitySlotsMock };
});
vi.mock('$lib/server/scheduling/public/appointments', () => ({
	createJointAppointment: createJointAppointmentMock,
	createManualAppointment: createManualAppointmentMock,
	findAppointmentCreationReplay: findAppointmentCreationReplayMock
}));

describe('public booking UX helpers', () => {
	it('bloquea reservas si no puede leer el estado comercial', async () => {
		const supabase = {
			from: (table: string) => {
				expect(table).toBe('business_subscriptions');
				return {
					select: () => ({
						eq: () => ({
							maybeSingle: async () => ({ data: null, error: { message: 'timeout' } })
						})
					})
				};
			}
		};

		expect(await canUsePublicBusiness(supabase as never, 'biz-1')).toBe(false);
	});

	it('usa un mensaje claro cuando el horario público ya no está disponible', () => {
		expect(getPublicBookingErrorMessage(new Error('PUBLIC_SLOT_UNAVAILABLE'))).toBe(
			'Ese horario acaba de ser ocupado. Elegí otro de los horarios disponibles.'
		);
	});

	it.each([
		['PUBLIC_RATE_LIMIT_IP', 'PUBLIC_RATE_LIMIT_IP'],
		['PUBLIC_RATE_LIMIT_PHONE', 'PUBLIC_RATE_LIMIT_PHONE'],
		['PUBLIC_BOOKING_ACTIVE_LIMIT', 'PUBLIC_BOOKING_ACTIVE_LIMIT'],
		['PUBLIC_BOOKING_BLOCKED_PATIENT', 'PUBLIC_BOOKING_BLOCKED_PATIENT'],
		['PATIENT_BLOCKED', 'PUBLIC_BOOKING_BLOCKED_PATIENT'],
		['PUBLIC_CAPTCHA_REQUIRED', 'PUBLIC_CAPTCHA_REQUIRED'],
		['PUBLIC_CAPTCHA_FAILED', 'PUBLIC_CAPTCHA_FAILED'],
		['PUBLIC_PATIENT_NAME_REQUIRED', 'PUBLIC_PATIENT_NAME_REQUIRED'],
		['PATIENT_NAME_REQUIRED', 'PUBLIC_PATIENT_NAME_REQUIRED'],
		['PUBLIC_PATIENT_NAME_INVALID', 'PUBLIC_PATIENT_NAME_INVALID'],
		['PATIENT_NAME_ALREADY_EXISTS', 'PATIENT_NAME_ALREADY_EXISTS'],
		['PATIENT_DNI_ALREADY_EXISTS', 'PATIENT_DNI_ALREADY_EXISTS'],
		['SERVICE_NOT_FOUND', 'SERVICE_NOT_FOUND'],
		['PROFESSIONAL_NOT_FOUND', 'PROFESSIONAL_NOT_FOUND'],
		['PROFESSIONAL_SERVICE_NOT_ASSIGNED', 'PROFESSIONAL_SERVICE_NOT_ASSIGNED'],
		['TEAM_PROFESSIONAL_SERVICE_NOT_ASSIGNED', 'TEAM_PROFESSIONAL_SERVICE_NOT_ASSIGNED'],
		['JOINT_APPOINTMENT_REQUIRES_TWO_PROFESSIONALS', 'PUBLIC_JOINT_REQUIRES_TWO_PROFESSIONALS']
	] as const)('no confunde la causa técnica %s con otro mensaje', (technicalCode, expectedCode) => {
		const error = new Error(technicalCode);
		expect(getPublicBookingErrorCode(error)).toBe(expectedCode);
		expect(getPublicBookingErrorMessage(error)).toBe(PUBLIC_BOOKING_ERROR_MESSAGES[expectedCode]);
	});

	it('mantiene distintos y accionables todos los mensajes visibles', () => {
		const messages = Object.values(PUBLIC_BOOKING_ERROR_MESSAGES);
		expect(new Set(messages).size).toBe(messages.length);
		for (const message of messages) {
			expect(message).not.toMatch(/PUBLIC_|patient_id|appointments_|rate.?limit/i);
		}
		expect(PUBLIC_BOOKING_ERROR_MESSAGES.PUBLIC_BOOKING_ACTIVE_LIMIT).toContain('4 turnos');
		expect(PUBLIC_BOOKING_ERROR_MESSAGES.PUBLIC_BOOKING_ACTIVE_LIMIT).toContain('a futuro');
		expect(PUBLIC_BOOKING_ERROR_MESSAGES.PUBLIC_BOOKING_ACTIVE_LIMIT).toContain('persona');
		expect(PUBLIC_BOOKING_ERROR_MESSAGES.PUBLIC_PATIENT_NAME_REQUIRED).toContain('nombre y apellido');
		expect(PUBLIC_BOOKING_ERROR_MESSAGES.PUBLIC_PATIENT_NAME_INVALID).toContain('sin números');
		expect(PUBLIC_BOOKING_ERROR_MESSAGES.PUBLIC_PATIENT_NAME_INVALID).toContain('guiones');
	});

	it('resume días con nombres completos y sin repetir disponibilidad por cada día', () => {
		const slots: AvailabilitySlot[] = [
			{
				date: '2026-06-03',
				time: '09:00',
				starts_at: '2026-06-03T12:00:00.000Z',
				ends_at: '2026-06-03T12:30:00.000Z',
				professional_id: 'professional-1',
				professional_name: 'Profesional'
			},
			{
				date: '2026-06-03',
				time: '09:30',
				starts_at: '2026-06-03T12:30:00.000Z',
				ends_at: '2026-06-03T13:00:00.000Z',
				professional_id: 'professional-1',
				professional_name: 'Profesional'
			}
		];

		const days = summarizeSlotsByDate(slots, 'America/Argentina/Buenos_Aires');
		// The day and month stay together: a narrow screen breaks after the weekday.
		expect(days).toEqual([{ date: '2026-06-03', label: 'Miércoles 3\u00a0de\u00a0junio', count: 2 }]);
	});

	it('ordena los días cronológicamente aunque los slots lleguen desordenados', () => {
		const slotFor = (date: string): AvailabilitySlot => ({
			date,
			time: '09:00',
			starts_at: `${date}T12:00:00.000Z`,
			ends_at: `${date}T12:30:00.000Z`,
			professional_id: 'professional-1',
			professional_name: 'Profesional'
		});
		const days = summarizeSlotsByDate(
			[slotFor('2026-06-20'), slotFor('2026-06-03'), slotFor('2026-06-10')],
			'America/Argentina/Buenos_Aires'
		);
		expect(days.map((day) => day.date)).toEqual(['2026-06-03', '2026-06-10', '2026-06-20']);
	});
});

const createPatientPolicyMock = (input: {
	patients: Array<{ id: string; full_name: string; blocked: boolean }>;
	activeFutureCount?: number;
}) => {
	const calls: Array<{
		table?: string;
		method: string;
		column?: string;
		value?: unknown;
		fn?: string;
		args?: Record<string, unknown>;
	}> = [];
	const supabase = {
		rpc: async (fn: string, args: Record<string, unknown>) => {
			calls.push({ method: 'rpc', fn, args });
			return { data: input.activeFutureCount ?? 0, error: null };
		},
		from: (table: string) => ({
			select: () => {
				const query: Record<string, any> = {
					eq: (column: string, value: unknown) => {
						calls.push({ table, method: 'eq', column, value });
						return query;
					},
					is: (column: string, value: unknown) => {
						calls.push({ table, method: 'is', column, value });
						return query;
					}
				};
				query.then = (resolve: (value: unknown) => unknown) =>
					resolve({ data: input.patients, error: null });
				return query;
			}
		})
	};
	return { supabase: supabase as never, calls };
};

describe('public booking patient capacity', () => {
	const now = new Date('2026-07-10T15:00:00.000Z');

	it('permite el cuarto turno activo futuro', async () => {
		const { supabase } = createPatientPolicyMock({
			patients: [{ id: 'patient-1', full_name: 'Ana Gomez', blocked: false }],
			activeFutureCount: 3
		});

		await expect(
			assertPublicBookingPatientPolicy(supabase, {
				businessId: 'business-1',
				patientName: 'Ana Gomez',
				phoneE164: '+5493515550000',
				now
			})
		).resolves.toBeUndefined();
	});

	it('rechaza inequívocamente el quinto turno activo futuro', async () => {
		const { supabase } = createPatientPolicyMock({
			patients: [{ id: 'patient-1', full_name: 'Ana Gomez', blocked: false }],
			activeFutureCount: 4
		});

		await expect(
			assertPublicBookingPatientPolicy(supabase, {
				businessId: 'business-1',
				patientName: 'Ana Gomez',
				phoneE164: '+5493515550000',
				now
			})
		).rejects.toThrow('PUBLIC_BOOKING_ACTIVE_LIMIT');
	});

	it('consulta el cupo por ID y por el bucket antiabuso de una coincidencia exacta', async () => {
		const { supabase, calls } = createPatientPolicyMock({
			patients: [{ id: 'patient-1', full_name: 'Ana Gomez', blocked: false }],
			activeFutureCount: 0
		});

		await assertPublicBookingPatientPolicy(supabase, {
			businessId: 'business-1',
			patientName: '  Ana   Gomez  ',
			phoneE164: '+5493515559999',
			now
		});

		expect(calls).toContainEqual({
			method: 'rpc',
			fn: 'get_public_booking_active_future_count_for_request',
			args: {
				p_business_id: 'business-1',
				p_patient_id: 'patient-1',
				p_patient_name: '  Ana   Gomez  ',
				p_phone_e164: '+5493515559999',
				p_now: now.toISOString()
			}
		});
	});

	it('el mismo teléfono con otro nombre no hereda bloqueo ni cupo', async () => {
		const { supabase, calls } = createPatientPolicyMock({
			patients: [{ id: 'patient-juan', full_name: 'Juan Pedro', blocked: true }]
		});

		await expect(
			assertPublicBookingPatientPolicy(supabase, {
				businessId: 'business-1',
				patientName: 'Carlos Gomez',
				phoneE164: '+5493515550000',
				now
			})
		).resolves.toBeUndefined();
		expect(calls).toContainEqual({
			method: 'rpc',
			fn: 'get_public_booking_active_future_count_for_request',
			args: {
				p_business_id: 'business-1',
				p_patient_id: null,
				p_patient_name: 'Carlos Gomez',
				p_phone_e164: '+5493515550000',
				p_now: now.toISOString()
			}
		});
	});

	it('varias coincidencias exactas son ambiguas y nunca elige la primera', async () => {
		const { supabase, calls } = createPatientPolicyMock({
			patients: [
				{ id: 'patient-1', full_name: 'Ana Gomez', blocked: false },
				{ id: 'patient-2', full_name: 'Ana Gómez', blocked: true }
			]
		});

		await expect(
			assertPublicBookingPatientPolicy(supabase, {
				businessId: 'business-1',
				patientName: 'Ana Gomez',
				phoneE164: '+5493515550000',
				now
			})
		).resolves.toBeUndefined();
		expect(calls).toContainEqual({
			method: 'rpc',
			fn: 'get_public_booking_active_future_count_for_request',
			args: {
				p_business_id: 'business-1',
				p_patient_id: null,
				p_patient_name: 'Ana Gomez',
				p_phone_e164: '+5493515550000',
				p_now: now.toISOString()
			}
		});
	});

	it('informa por separado cuando la ficha está bloqueada', async () => {
		const { supabase } = createPatientPolicyMock({
			patients: [{ id: 'patient-1', full_name: 'Ana Gomez', blocked: true }]
		});

		await expect(
			assertPublicBookingPatientPolicy(supabase, {
				businessId: 'business-1',
				patientName: 'Ana Gomez',
				phoneE164: '+5493515550000',
				now
			})
		).rejects.toThrow('PUBLIC_BOOKING_BLOCKED_PATIENT');
	});
});

describe('public joint booking creation', () => {
	beforeEach(() => {
		createJointAppointmentMock.mockReset();
		createManualAppointmentMock.mockReset();
		findAppointmentCreationReplayMock.mockReset();
		findAppointmentCreationReplayMock.mockResolvedValue(null);
		getAvailabilitySlotsMock.mockReset();
	});

	it('confirma el equipo con una única creación atómica y una sola fila de turno', async () => {
		const slot: AvailabilitySlot = {
			date: '2026-07-30',
			time: '09:23',
			starts_at: '2026-07-30T12:23:00.000Z',
			ends_at: '2026-07-30T12:53:00.000Z',
			professional_id: 'pro-1',
			professional_name: 'Dra. Uno, Dr. Dos',
			professional_ids: ['pro-1', 'pro-2'],
			professional_names: ['Dra. Uno', 'Dr. Dos'],
			is_joint: true
		};
		getAvailabilitySlotsMock.mockResolvedValue([slot]);
		createJointAppointmentMock.mockResolvedValue({
			id: 'appointment-joint-1',
			confirmation_token: 'token-joint-1'
		});
		const attemptRows: Array<Record<string, unknown>> = [];
		const countQuery = queryBuilder([]);
		(countQuery as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
			resolve({ count: 0, error: null });
		const supabase = {
			from: (table: string) => {
				if (table === 'businesses') {
					return { select: () => queryBuilder(business) };
				}
				if (table === 'business_subscriptions') {
					return { select: () => queryBuilder(subscription) };
				}
				if (table === 'patients') {
					return { select: () => queryBuilder([]) };
				}
				if (table === 'public_booking_attempts') {
					return {
						select: () => countQuery,
						insert: async (row: Record<string, unknown>) => {
							attemptRows.push(row);
							return { error: null };
						}
					};
				}
				throw new Error(`Tabla inesperada en la prueba: ${table}`);
			},
			rpc: async (name: string) => {
				if (name === 'get_public_booking_active_future_count_for_request') {
				return { data: 0, error: null };
			}
				throw new Error(`RPC inesperado en la prueba: ${name}`);
			}
		};

		const result = await createPublicBooking(supabase as never, {
			slug: business.slug,
			serviceId: 'svc-1',
			bookingMode: 'joint',
			professionalIds: ['pro-1', 'pro-2'],
			slotStartsAt: slot.starts_at,
			patientName: 'Ana Gomez',
			patientPhone: '+54 9 351 555 0000',
			idempotencyKey: 'a1000000-0000-4000-8000-000000000001',
			now: new Date('2026-07-25T12:00:00.000Z')
		});

		expect(result.appointment.id).toBe('appointment-joint-1');
		expect(getAvailabilitySlotsMock).toHaveBeenCalledWith(
			supabase,
			expect.objectContaining({
				serviceId: 'svc-1',
				professionalId: null,
				professionalIds: ['pro-1', 'pro-2'],
				fromDate: '2026-07-30',
				toDate: '2026-07-30',
				publicOnly: true
			})
		);
		expect(createJointAppointmentMock).toHaveBeenCalledTimes(1);
		expect(createJointAppointmentMock).toHaveBeenCalledWith(
			supabase,
			expect.objectContaining({
				businessId: business.id,
				serviceId: 'svc-1',
				professionalIds: ['pro-1', 'pro-2'],
				source: 'public_booking',
				patient: expect.objectContaining({
					mode: 'public',
					name: 'Ana Gomez',
					phone: '+54 9 351 555 0000'
				}),
				idempotencyKey: 'a1000000-0000-4000-8000-000000000001'
			})
		);
		expect(createManualAppointmentMock).not.toHaveBeenCalled();
		expect(attemptRows).toHaveLength(1);
		expect(attemptRows[0]).toMatchObject({
			action: 'booking_create',
			success: true,
			metadata: {
				appointment_id: 'appointment-joint-1',
				booking_mode: 'joint',
				professional_ids: ['pro-1', 'pro-2']
			}
		});
	});

	it('un reintento recupera el turno previo antes del cupo, rate limit y disponibilidad', async () => {
		findAppointmentCreationReplayMock.mockResolvedValue({
			id: 'appointment-existing',
			confirmation_token: 'token-existing',
			idempotent_replay: true
		});
		const supabase = {
			from: (table: string) => {
				if (table === 'businesses') return { select: () => queryBuilder(business) };
				if (table === 'business_subscriptions') {
					return { select: () => queryBuilder(subscription) };
				}
				throw new Error(`El replay no debe consultar ${table}`);
			}
		};

		const result = await createPublicBooking(supabase as never, {
			slug: business.slug,
			serviceId: 'svc-1',
			professionalId: 'pro-1',
			slotStartsAt: '2026-07-30T12:23:00.000Z',
			patientName: 'Ana Gomez',
			patientPhone: '+54 9 351 555 0000',
			idempotencyKey: 'a1000000-0000-4000-8000-000000000001'
		});

		expect(result.appointment).toMatchObject({
			id: 'appointment-existing',
			idempotent_replay: true
		});
		expect(findAppointmentCreationReplayMock).toHaveBeenCalledTimes(1);
		expect(getAvailabilitySlotsMock).not.toHaveBeenCalled();
		expect(createJointAppointmentMock).not.toHaveBeenCalled();
		expect(createManualAppointmentMock).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// loadPublicBookingState: el flujo navega la misma URL varias veces; estos tests
// fijan el contrato de lecturas acotadas, frescas y sin fallback de tablas.
// ---------------------------------------------------------------------------

const business = {
	id: '00000000-0000-4000-8000-000000000001',
	name: 'Consultorio Test',
	slug: 'consultorio-test',
	phone: null,
	address: 'Av. Test 123',
	address_instructions: null,
	maps_url: null,
	logo_url: null,
	timezone: 'America/Argentina/Cordoba',
	public_booking_enabled: true,
	is_active: true,
	created_at: '2026-01-01T00:00:00.000Z',
	min_booking_notice_minutes: 0,
	max_booking_days_ahead: 30,
	cancellation_policy: null
};

const subscription = {
	id: 'sub-1',
	business_id: '00000000-0000-4000-8000-000000000001',
	commercial_access_enabled: true,
	is_permanent: true,
	subscription_status: 'active',
	paid_until: null,
	grace_until: null,
	restricted_until: null,
	archived_at: null,
	expiration_notice_enabled: false
};

const queryBuilder = (data: unknown) => {
	const builder: Record<string, unknown> = {};
	for (const method of [
		'eq',
		'in',
		'gte',
		'lte',
		'lt',
		'gt',
		'or',
		'order',
		'limit',
		'is',
		'neq',
		'not'
	]) {
		builder[method] = () => builder;
	}
	builder.maybeSingle = async () => ({ data, error: null });
	builder.single = async () => ({ data, error: null });
	(builder as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
		resolve({ data, error: null });
	return builder;
};

// Real typed SDK with simulated HTTP. SQL completeness/permissions have their
// own database tests; these cases verify selection, calculation and read cost.
const createSupabaseMock = (overrides: {
 professionalName?: string; includeUnavailableFixtures?: boolean; includeSecondProfessional?: boolean;
 failWindow?: boolean; blockFirstWindow?: boolean;
} = {}) => {
 const tableReads: string[] = [];
 const requests: Array<{ name: string; body: Record<string, unknown> }> = [];
 const professional = { id: '00000000-0000-4000-8000-000000000003', name: overrides.professionalName ?? 'Dra. Uno', specialty: null, avatar_url: null,
  is_active: true, is_public: true, sort_order: 0 };
 const professionals = [professional, ...(overrides.includeSecondProfessional ? [{ ...professional, id: '00000000-0000-4000-8000-000000000004', name: 'Dr. Dos', sort_order: 1 }] : []),
  ...(overrides.includeUnavailableFixtures ? [{ ...professional, id: '00000000-0000-4000-8000-000000000005', name: 'Dr. Sin horarios', sort_order: 2 }] : [])]
  .filter(row => row.name.trim());
 const ids = new Set(professionals.map(row => row.id));
 const service = { id: '00000000-0000-4000-8000-000000000002', business_id: business.id, name: 'Consulta', description: null, duration_minutes: 30,
  buffer_before_minutes: 0, buffer_after_minutes: 0, price_label: null, is_active: true, is_public: true, sort_order: 0 };
 const source = {
  schema_version: 2, business_id: business.id, scope: 'public', configuration_revision: 4, generated_at: new Date().toISOString(),
  business: { timezone: business.timezone, max_booking_days_ahead: business.max_booking_days_ahead, min_booking_notice_minutes: 0,
   is_active: true, public_booking_enabled: true },
  services: [service, ...(overrides.includeUnavailableFixtures ? [{ ...service, id: '00000000-0000-4000-8000-000000000006', name: 'Sin disponibilidad', sort_order: 1 }] : [])],
  professionals,
  assignments: [...ids].map(professional_id => ({ service_id: service.id, professional_id })).concat(
   overrides.includeUnavailableFixtures ? [{ service_id: '00000000-0000-4000-8000-000000000006', professional_id: '00000000-0000-4000-8000-000000000005' }] : []),
  rules: Array.from({ length: 7 }, (_, weekday) => [
   { id: `00000000-0000-4000-8000-${String(100 + weekday).padStart(12, '0')}`, professional_id: '00000000-0000-4000-8000-000000000003', weekday, start_time: '09:00:00', end_time: '12:00:00',
    slot_interval_minutes: 30, break_minutes: 0, is_active: true, service_scope: 'all', allowed_service_ids: [] },
   ...(overrides.includeSecondProfessional ? [{ id: `00000000-0000-4000-8000-${String(200 + weekday).padStart(12, '0')}`, professional_id: '00000000-0000-4000-8000-000000000004', weekday,
    start_time: '09:23:00', end_time: '12:00:00', slot_interval_minutes: 15, break_minutes: 0, is_active: true, service_scope: 'all', allowed_service_ids: [] }] : [])
  ]).flat().filter(row => ids.has(row.professional_id))
 };
 const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const name = url.pathname.split('/').at(-1) ?? '';
  if (!url.pathname.includes('/rpc/')) {
   tableReads.push(name);
   if (name === 'businesses') return Response.json(business);
   if (name === 'business_subscriptions') return Response.json(subscription);
   throw new Error('Unexpected table read: ' + name);
  }
  const body = readRecord(JSON.parse(String(init?.body)), 'synthetic.rpcBody');
  requests.push({ name, body });
  if (name === 'get_availability_catalog') return Response.json(source);
  if (name !== 'get_availability_window') throw new Error('Unexpected RPC: ' + name);
  if (overrides.failWindow) return Response.json({ blocks: [] });
  const exceptions = overrides.blockFirstWindow ? [{ id: '00000000-0000-4000-8000-000000000300', professional_id: null,
   starts_at: todayForBusiness(business) + 'T00:00:00Z', ends_at: addDaysToDateString(todayForBusiness(business), 15) + 'T03:00:00Z',
   type: 'blocked', allowed_service_ids: [] }] : [];
  return Response.json({ schema_version: 2, complete: true, business_id: business.id, scope: 'public', configuration_revision: 4,
   generated_at: source.generated_at, from_date: body.p_from_date, to_date: body.p_to_date, professional_ids: body.p_professional_ids,
   counts: { blocks: 0, exceptions: exceptions.length }, blocks: [], exceptions });
 });
 const client = createClient<CitaDatabase>('https://synthetic.example.test', 'synthetic-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch }
 });
 return { client, tableReads, requests, source };
};

describe('loadPublicBookingState (performance del flujo público)', () => {
	beforeEach(() => {
		clearPublicBookingScanCache();
		getAvailabilitySlotsMock.mockReset();
	});

	it('muestra el catálogo inicial sin disparar el camino de consultas por servicio', async () => {
		const supabase = createSupabaseMock();

		const state = await loadPublicBookingState(supabase.client, {
			slug: business.slug
		});

		expect(state.issue).toBeNull();
		expect(state.services.map((service) => service.id)).toEqual(['00000000-0000-4000-8000-000000000002']);
		expect(getAvailabilitySlotsMock).not.toHaveBeenCalled();
		expect(supabase.tableReads).not.toContain('availability_exceptions');
		expect(supabase.tableReads).not.toContain('appointment_professionals');
	});

	it('conserva ocultos servicios y profesionales sin un horario semanal activo', async () => {
		const supabase = createSupabaseMock({
			includeUnavailableFixtures: true
		});

		const initial = await loadPublicBookingState(supabase.client, {
			slug: business.slug
		});
		expect(initial.services.map((service) => service.id)).toEqual(['00000000-0000-4000-8000-000000000002']);

		const professionalStep = await loadPublicBookingState(supabase.client, {
			slug: business.slug,
			serviceId: '00000000-0000-4000-8000-000000000002'
		});
		expect(professionalStep.professionals.map((professional) => professional.id)).toEqual([
			'00000000-0000-4000-8000-000000000003'
		]);
	});

	it('no consulta la agenda hasta que la selección individual o conjunta está completa', async () => {
		const supabase = createSupabaseMock({ includeSecondProfessional: true });

		const state = await loadPublicBookingState(supabase.client, {
			slug: business.slug,
			serviceId: '00000000-0000-4000-8000-000000000002',
			bookingMode: 'joint',
			professionalIds: ['00000000-0000-4000-8000-000000000003']
		});

		expect(state.issue).toBeNull();
		expect(state.days).toEqual([]);
		expect(state.professionals.map((professional) => professional.id)).toEqual(['00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004']);
		expect(supabase.tableReads).not.toContain('availability_exceptions');
		expect(supabase.tableReads).not.toContain('appointment_professionals');
	});

	it('calcula días y horarios únicamente cuando los dos integrantes están libres', async () => {
		const supabase = createSupabaseMock({
			includeSecondProfessional: true
		});
		const today = todayForBusiness(business);
		const date = addDaysToDateString(today, 2);

		const dayState = await loadPublicBookingState(supabase.client, {
			slug: business.slug,
			serviceId: '00000000-0000-4000-8000-000000000002',
			bookingMode: 'joint',
			professionalIds: ['00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004']
		});
		expect(dayState.issue).toBeNull();
		expect(dayState.days.length).toBeGreaterThan(0);
		expect(dayState.slots).toEqual([]);
		expect(dayState.days.every((day) => day.count === 1)).toBe(true);

		const slotState = await loadPublicBookingState(supabase.client, {
			slug: business.slug,
			serviceId: '00000000-0000-4000-8000-000000000002',
			bookingMode: 'joint',
			professionalIds: ['00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'],
			date
		});
		expect(slotState.issue).toBeNull();
		expect(slotState.slots.length).toBeGreaterThan(0);
		expect(
			slotState.slots.every(
				(slot) =>
					slot.is_joint && slot.professional_ids?.join(',') === '00000000-0000-4000-8000-000000000003,00000000-0000-4000-8000-000000000004' && slot.date === date
			)
		).toBe(true);
		expect(slotState.slots[0]?.time).toBe('09:23');
	});

	it('consulta únicamente la fecha elegida y no reconsulta el catálogo por fragmento', async () => {
		const supabase = createSupabaseMock();
		const today = todayForBusiness(business);
		const date = addDaysToDateString(today, 2);

		const state = await loadPublicBookingState(supabase.client, {
			slug: business.slug,
			serviceId: '00000000-0000-4000-8000-000000000002',
			professionalId: '00000000-0000-4000-8000-000000000003',
			date
		});

		expect(state.issue).toBeNull();
		expect(state.slots.length).toBeGreaterThan(0);
		expect(state.slots.every((slot) => slot.date === date)).toBe(true);
		expect(supabase.requests.map(row => row.name)).toEqual(['get_availability_catalog', 'get_availability_window']);
		expect(supabase.requests[1].body).toMatchObject({ p_from_date: date, p_to_date: date });
		expect(getAvailabilitySlotsMock).not.toHaveBeenCalled();
		const dates = state.days.map((day) => day.date);
		expect(dates).toEqual([...dates].sort());
	});

	it('no ofrece profesionales públicos sin nombre visible', async () => {
		const supabase = createSupabaseMock({ professionalName: '   ' });

		const state = await loadPublicBookingState(supabase.client, {
			slug: business.slug,
			serviceId: '00000000-0000-4000-8000-000000000002'
		});

		expect(state.issue).toBe('no_services');
		expect(state.professionals).toEqual([]);
		expect(getAvailabilitySlotsMock).not.toHaveBeenCalled();
	});

	it('una nueva navegación consulta ocupación fresca sin conservar disponibilidad global', async () => {
		const supabase = createSupabaseMock();
		const today = todayForBusiness(business);
		const date = addDaysToDateString(today, 2);
		const input = {
			slug: business.slug,
			serviceId: '00000000-0000-4000-8000-000000000002',
			professionalId: '00000000-0000-4000-8000-000000000003',
			date
		};

		await loadPublicBookingState(supabase.client, input);
		const callsAfterFirst = supabase.requests.length;
		const second = await loadPublicBookingState(supabase.client, input);

		expect(second.issue).toBeNull();
		expect(supabase.requests.length).toBe(callsAfterFirst + 2);
		expect(supabase.requests.filter(row => row.name === 'get_availability_window')).toHaveLength(2);
	});

	it('permite acceder directamente a una fecha lejana sin descargar fechas intermedias', async () => {
		const supabase = createSupabaseMock();
		const today = todayForBusiness(business);
		const farDate = addDaysToDateString(today, 20);

		const state = await loadPublicBookingState(supabase.client, {
			slug: business.slug,
			serviceId: '00000000-0000-4000-8000-000000000002',
			professionalId: '00000000-0000-4000-8000-000000000003',
			date: farDate
		});

		expect(state.issue).toBeNull();
		expect(state.slots.length).toBeGreaterThan(0);
		expect(state.slots.every((slot) => slot.date === farDate)).toBe(true);
		expect(getAvailabilitySlotsMock).not.toHaveBeenCalled();
		expect(supabase.requests[1].body).toMatchObject({ p_from_date: farDate, p_to_date: farDate });
		const dates = state.days.map((day) => day.date);
		expect(dates).toEqual([...dates].sort());
		expect(dates).toContain(farDate);
	});
 it('carga sólo quince fechas al abrir y conserva navegación aunque estén todas bloqueadas', async () => {
  const fixture = createSupabaseMock({ blockFirstWindow: true });
  const today = todayForBusiness(business);
  const input = { slug: business.slug, serviceId: '00000000-0000-4000-8000-000000000002', professionalId: '00000000-0000-4000-8000-000000000003' };
  const first = await loadPublicBookingState(fixture.client, input);
  expect(first.days).toEqual([]);
  expect(first.issue).toBe('no_availability');
  expect(first.dateWindow).toEqual({ fromDate: today, toDate: addDaysToDateString(today, 14), previousFromDate: null,
   nextFromDate: addDaysToDateString(today, 15), horizonEnd: addDaysToDateString(today, 30) });
  expect(fixture.requests.map(row => row.name)).toEqual(['get_availability_catalog', 'get_availability_window']);
  expect(fixture.requests[1].body).toMatchObject({ p_from_date: today, p_to_date: addDaysToDateString(today, 14) });
  const next = await loadPublicBookingState(fixture.client, { ...input, datesFrom: first.dateWindow?.nextFromDate });
  expect(next.days.length).toBeGreaterThan(0);
  expect(next.dateWindow).toMatchObject({ fromDate: addDaysToDateString(today, 15), previousFromDate: today,
   nextFromDate: addDaysToDateString(today, 30) });
  const last = await loadPublicBookingState(fixture.client, { ...input, datesFrom: next.dateWindow?.nextFromDate });
  expect(last.dateWindow).toMatchObject({ fromDate: addDaysToDateString(today, 30), toDate: addDaysToDateString(today, 30), nextFromDate: null });
  expect(fixture.requests).toHaveLength(6);
 });
 it('rechaza respuestas 200 parciales sin fallback ni disponibilidad aparente', async () => {
  const fixture = createSupabaseMock({ failWindow: true });
  await expect(loadPublicBookingState(fixture.client, { slug: business.slug, serviceId: '00000000-0000-4000-8000-000000000002',
   professionalId: '00000000-0000-4000-8000-000000000003' })).rejects.toThrow();
  expect(fixture.tableReads).toEqual(['businesses', 'business_subscriptions']);
  expect(fixture.requests).toHaveLength(2);
 });
 it('un cursor inexistente o fuera de horizonte no dispara lecturas de ocupación', async () => {
  for (const datesFrom of ['2026-02-30', addDaysToDateString(todayForBusiness(business), 31)]) {
   const fixture = createSupabaseMock();
   await expect(loadPublicBookingState(fixture.client, { slug: business.slug, serviceId: '00000000-0000-4000-8000-000000000002',
    professionalId: '00000000-0000-4000-8000-000000000003', datesFrom })).rejects.toThrow();
   expect(fixture.requests.map(row => row.name)).toEqual(['get_availability_catalog']);
  }
 });
 it('conserva una franja restringida sin prestaciones cerrada en el turnero público', async () => {
  const fixture = createSupabaseMock();
  fixture.source.rules.forEach(row => { row.service_scope = 'restricted'; });
  const state = await loadPublicBookingState(fixture.client, { slug: business.slug, serviceId: '00000000-0000-4000-8000-000000000002',
   professionalId: '00000000-0000-4000-8000-000000000003' });
  expect(state.days).toEqual([]);
  expect(state.issue).toBe('no_availability');
 });

});

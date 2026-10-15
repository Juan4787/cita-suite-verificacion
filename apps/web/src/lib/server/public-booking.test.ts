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
	todayForBusiness
} from './public-booking';
import type { AvailabilitySlot } from './availability';

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

vi.mock('./availability', async (importOriginal) => {
	const original = await importOriginal<typeof import('./availability')>();
	return { ...original, getAvailabilitySlots: getAvailabilitySlotsMock };
});
vi.mock('./appointments', () => ({
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
		expect(days).toEqual([{ date: '2026-06-03', label: 'Miércoles 3 de junio', count: 2 }]);
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
// fijan el contrato de performance (caché + reuso del escaneo de días).
// ---------------------------------------------------------------------------

const business = {
	id: 'biz-1',
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
	business_id: 'biz-1',
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

const createSupabaseMock = (
	overrides: {
		professionalName?: string;
		includeUnavailableFixtures?: boolean;
		includeSecondProfessional?: boolean;
	} = {}
) => {
	const tableReads: string[] = [];
	return {
	tableReads,
	from: (table: string) => {
		tableReads.push(table);
		return {
		select: (columns: string) => {
			const professionalName = overrides.professionalName ?? 'Dra. Uno';
			if (table === 'businesses') return queryBuilder(business);
			if (table === 'business_subscriptions') return queryBuilder(subscription);
			if (table === 'services') {
				const services = [
					{
						id: 'svc-1',
						business_id: 'biz-1',
						name: 'Consulta',
						description: null,
						duration_minutes: 30,
						buffer_before_minutes: 0,
						buffer_after_minutes: 0,
						price_label: null,
						is_active: true,
						is_public: true,
						sort_order: 0
					}
				];
				if (overrides.includeUnavailableFixtures) {
					services.push({
						...services[0],
						id: 'svc-unavailable',
						name: 'Sin disponibilidad',
						sort_order: 1
					});
				}
				return queryBuilder(services);
			}
			if (table === 'professionals') {
				const professionals = [
					{
						id: 'pro-1',
						name: professionalName,
						specialty: null,
						avatar_url: null,
						is_active: true,
						is_public: true,
						sort_order: 0
					}
				];
				if (overrides.includeSecondProfessional) {
					professionals.push({
						...professionals[0],
						id: 'pro-2',
						name: 'Dr. Dos',
						sort_order: 1
					});
				}
				if (overrides.includeUnavailableFixtures) {
					professionals.push({
						...professionals[0],
						id: 'pro-unavailable',
						name: 'Dr. Sin horarios',
						sort_order: 1
					});
				}
				return queryBuilder(professionals);
			}
			if (table === 'professional_services') {
				if (columns.includes('professionals!inner')) {
					return queryBuilder([
						{
							professional_id: 'pro-1',
							professionals: {
								id: 'pro-1',
								name: professionalName,
								specialty: null,
								avatar_url: null,
								is_active: true,
								is_public: true,
								sort_order: 0
							}
						},
						...(overrides.includeSecondProfessional
							? [
									{
										professional_id: 'pro-2',
										professionals: {
											id: 'pro-2',
											name: 'Dr. Dos',
											specialty: 'Control',
											avatar_url: null,
											is_active: true,
											is_public: true,
											sort_order: 1
										}
									}
								]
							: [])
					]);
				}
				return queryBuilder([
					{ service_id: 'svc-1', professional_id: 'pro-1' },
					...(overrides.includeSecondProfessional
						? [{ service_id: 'svc-1', professional_id: 'pro-2' }]
						: []),
					...(overrides.includeUnavailableFixtures
						? [
								{ service_id: 'svc-1', professional_id: 'pro-unavailable' },
										{
											service_id: 'svc-unavailable',
											professional_id: 'pro-unavailable'
										}
							]
						: [])
				]);
			}
			if (table === 'availability_rules') {
				return queryBuilder(
					Array.from({ length: 7 }, (_, weekday) => [
						{
							id: `rule-pro-1-${weekday}`,
							professional_id: 'pro-1',
							weekday,
							start_time: '09:00:00',
							end_time: '12:00:00',
							slot_interval_minutes: 30,
							break_minutes: 0,
							is_active: true
						},
						...(overrides.includeSecondProfessional
							? [
									{
										id: `rule-pro-2-${weekday}`,
										professional_id: 'pro-2',
										weekday,
										start_time: '09:23:00',
										end_time: '12:00:00',
										slot_interval_minutes: 15,
										break_minutes: 0,
										is_active: true
									}
								]
							: [])
					]).flat()
				);
			}
			return queryBuilder([]);
		}
	};
	}
	};
};

const slotsForRange = (fromDate: string, toDate: string): AvailabilitySlot[] => {
	const slots: AvailabilitySlot[] = [];
	let cursor = fromDate;
	while (cursor <= toDate) {
		slots.push({
			date: cursor,
			time: '10:00',
			starts_at: `${cursor}T13:00:00.000Z`,
			ends_at: `${cursor}T13:30:00.000Z`,
			professional_id: 'pro-1',
			professional_name: 'Dra. Uno'
		});
		cursor = addDaysToDateString(cursor, 1);
	}
	return slots;
};

describe('loadPublicBookingState (performance del flujo público)', () => {
	beforeEach(() => {
		clearPublicBookingScanCache();
		getAvailabilitySlotsMock.mockReset();
		getAvailabilitySlotsMock.mockImplementation(
			async (_supabase: unknown, input: { fromDate: string; toDate: string }) =>
				slotsForRange(input.fromDate, input.toDate)
		);
	});

	it('muestra el catálogo inicial sin disparar el camino de consultas por servicio', async () => {
		const supabase = createSupabaseMock();

		const state = await loadPublicBookingState(supabase as never, {
			slug: business.slug
		});

		expect(state.issue).toBeNull();
		expect(state.services.map((service) => service.id)).toEqual(['svc-1']);
		expect(getAvailabilitySlotsMock).not.toHaveBeenCalled();
		expect(supabase.tableReads).not.toContain('availability_exceptions');
		expect(supabase.tableReads).not.toContain('appointment_professionals');
	});

	it('conserva ocultos servicios y profesionales sin un horario semanal activo', async () => {
		const supabase = createSupabaseMock({
			includeUnavailableFixtures: true
		}) as never;

		const initial = await loadPublicBookingState(supabase, {
			slug: business.slug
		});
		expect(initial.services.map((service) => service.id)).toEqual(['svc-1']);

		const professionalStep = await loadPublicBookingState(supabase, {
			slug: business.slug,
			serviceId: 'svc-1'
		});
		expect(professionalStep.professionals.map((professional) => professional.id)).toEqual([
			'pro-1'
		]);
	});

	it('no consulta la agenda hasta que la selección individual o conjunta está completa', async () => {
		const supabase = createSupabaseMock({ includeSecondProfessional: true });

		const state = await loadPublicBookingState(supabase as never, {
			slug: business.slug,
			serviceId: 'svc-1',
			bookingMode: 'joint',
			professionalIds: ['pro-1']
		});

		expect(state.issue).toBeNull();
		expect(state.days).toEqual([]);
		expect(state.professionals.map((professional) => professional.id)).toEqual(['pro-1', 'pro-2']);
		expect(supabase.tableReads).not.toContain('availability_exceptions');
		expect(supabase.tableReads).not.toContain('appointment_professionals');
	});

	it('calcula días y horarios únicamente cuando los dos integrantes están libres', async () => {
		const supabase = createSupabaseMock({
			includeSecondProfessional: true
		}) as never;
		const today = todayForBusiness(business);
		const date = addDaysToDateString(today, 2);

		const dayState = await loadPublicBookingState(supabase, {
			slug: business.slug,
			serviceId: 'svc-1',
			bookingMode: 'joint',
			professionalIds: ['pro-1', 'pro-2']
		});
		expect(dayState.issue).toBeNull();
		expect(dayState.days.length).toBeGreaterThan(0);
		expect(dayState.slots).toEqual([]);
		expect(dayState.days.every((day) => day.count === 1)).toBe(true);

		const slotState = await loadPublicBookingState(supabase, {
			slug: business.slug,
			serviceId: 'svc-1',
			bookingMode: 'joint',
			professionalIds: ['pro-1', 'pro-2'],
			date
		});
		expect(slotState.issue).toBeNull();
		expect(slotState.slots.length).toBeGreaterThan(0);
		expect(
			slotState.slots.every(
				(slot) =>
					slot.is_joint && slot.professional_ids?.join(',') === 'pro-1,pro-2' && slot.date === date
			)
		).toBe(true);
		expect(slotState.slots[0]?.time).toBe('09:23');
	});

	it('la fecha elegida dentro del rango escaneado se filtra sin query extra', async () => {
		const supabase = createSupabaseMock() as never;
		const today = todayForBusiness(business);
		const date = addDaysToDateString(today, 2);

		const state = await loadPublicBookingState(supabase, {
			slug: business.slug,
			serviceId: 'svc-1',
			professionalId: 'pro-1',
			date
		});

		expect(state.issue).toBeNull();
		expect(state.slots.length).toBeGreaterThan(0);
		expect(state.slots.every((slot) => slot.date === date)).toBe(true);
		// La fecha puntual se filtra de la foto compartida y no dispara el camino
		// tradicional de cinco consultas de disponibilidad.
		expect(getAvailabilitySlotsMock).not.toHaveBeenCalled();
		const dates = state.days.map((day) => day.date);
		expect(dates).toEqual([...dates].sort());
	});

	it('no ofrece profesionales públicos sin nombre visible', async () => {
		const supabase = createSupabaseMock({ professionalName: '   ' }) as never;

		const state = await loadPublicBookingState(supabase, {
			slug: business.slug,
			serviceId: 'svc-1'
		});

		expect(state.issue).toBe('no_services');
		expect(state.professionals).toEqual([]);
		expect(getAvailabilitySlotsMock).not.toHaveBeenCalled();
	});

	it('navegar de nuevo con la misma selección reusa el caché (cero escaneos nuevos)', async () => {
		const supabase = createSupabaseMock() as never;
		const today = todayForBusiness(business);
		const date = addDaysToDateString(today, 2);
		const input = {
			slug: business.slug,
			serviceId: 'svc-1',
			professionalId: 'pro-1',
			date
		};

		await loadPublicBookingState(supabase, input);
		const callsAfterFirst = getAvailabilitySlotsMock.mock.calls.length;
		const second = await loadPublicBookingState(supabase, input);

		expect(second.issue).toBeNull();
		expect(getAvailabilitySlotsMock).toHaveBeenCalledTimes(callsAfterFirst);
	});

	it('incluye una fecha lejana en el único rango escaneado, sin query puntual', async () => {
		const supabase = createSupabaseMock() as never;
		const today = todayForBusiness(business);
		const farDate = addDaysToDateString(today, 20);

		const state = await loadPublicBookingState(supabase, {
			slug: business.slug,
			serviceId: 'svc-1',
			professionalId: 'pro-1',
			date: farDate
		});

		expect(state.issue).toBeNull();
		expect(state.slots.length).toBeGreaterThan(0);
		expect(state.slots.every((slot) => slot.date === farDate)).toBe(true);
		expect(getAvailabilitySlotsMock).not.toHaveBeenCalled();
		// El día lejano se integra ordenado a la lista de días.
		const dates = state.days.map((day) => day.date);
		expect(dates).toEqual([...dates].sort());
		expect(dates).toContain(farDate);
	});
});

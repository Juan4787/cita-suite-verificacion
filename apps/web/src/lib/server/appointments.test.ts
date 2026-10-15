import { describe, expect, it, vi } from 'vitest';

vi.mock('./audit', () => ({ writeAuditLog: vi.fn(async () => undefined) }));
import {
	APPOINTMENT_STATUSES,
	assertCanTransitionAppointment,
	createJointAppointment,
	createManualAppointment,
	findAppointmentCreationReplay,
	getHumanAppointmentErrorMessage,
	rescheduleAppointment,
	updateAppointmentStatus
} from './appointments';
import { writeAuditLog } from './audit';

// Mock mínimo de supabase para rescheduleAppointment: captura el payload del update.
const createRescheduleMock = (
	appointmentRow: Record<string, unknown>,
	options: { updateData?: Record<string, unknown> | null } = {}
) => {
	const updates: Record<string, unknown>[] = [];
	const supabase = {
		from: (table: string) => {
			if (table === 'appointments') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => ({ maybeSingle: async () => ({ data: appointmentRow, error: null }) })
						})
					}),
					update: (payload: Record<string, unknown>) => {
						updates.push(payload);
						return {
							eq: () => ({
								eq: () => ({
										eq: () => ({
										select: () => ({
											maybeSingle: async () => ({
												data: Object.hasOwn(options, 'updateData')
													? options.updateData
													: { id: appointmentRow.id },
												error: null
											})
										})
									})
								})
							})
						};
					}
				};
			}
			if (table === 'services') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => ({
								maybeSingle: async () => ({
									data: { duration_minutes: 30, is_active: true },
									error: null
								})
							})
						})
					})
				};
			}
			return { insert: async () => ({ error: null }) };
		}
	};
	return { supabase: supabase as any, updates };
};

const createStatusMock = (
	appointmentRow: Record<string, unknown>,
	options: { updateData?: Record<string, unknown> | null } = {}
) => {
	const auditRows: Record<string, unknown>[] = [];
	const updateFilters: Array<[string, unknown]> = [];
	const makeEqChain = (terminal: () => Promise<unknown>) => {
		const chain: any = {
			eq: (column: string, value: unknown) => {
				updateFilters.push([column, value]);
				return chain;
			},
			maybeSingle: terminal,
			select: () => makeEqChain(terminal)
		};
		return chain;
	};
	const supabase = {
		from: (table: string) => {
			if (table === 'appointments') {
				return {
					select: () =>
						makeEqChain(async () => ({ data: appointmentRow, error: null })),
					update: () =>
						makeEqChain(async () => ({
							data: Object.hasOwn(options, 'updateData') ? options.updateData : { id: appointmentRow.id },
							error: null
						}))
				};
			}
			if (table === 'audit_logs') {
				return { insert: async (row: Record<string, unknown>) => { auditRows.push(row); return { error: null }; } };
			}
			if (table === 'services') {
				return {
					select: () => makeEqChain(async () => ({ data: { duration_minutes: 30, is_active: true }, error: null }))
				};
			}
			throw new Error(`unexpected table ${table}`);
		}
	};
	return { supabase: supabase as any, auditRows, updateFilters };
};

const pastStart = new Date('2026-05-13T10:00:00.000Z');
const pastEnd = new Date('2026-05-13T11:00:00.000Z');
const now = new Date('2026-05-13T12:00:00.000Z');

describe('appointment transitions', () => {
	it('allows active appointments to be confirmed or cancelled', () => {
		expect(() =>
			assertCanTransitionAppointment({
				currentStatus: 'reserved',
				nextStatus: 'confirmed',
				startsAt: pastStart,
				endsAt: pastEnd,
				now
			})
		).not.toThrow();

		expect(() =>
			assertCanTransitionAppointment({
				currentStatus: 'confirmed',
				nextStatus: 'cancelled',
				startsAt: pastStart,
				endsAt: pastEnd,
				now
			})
		).not.toThrow();
	});

	it('blocks terminal appointments from returning to active states', () => {
		expect(() =>
			assertCanTransitionAppointment({
				currentStatus: 'cancelled',
				nextStatus: 'confirmed',
				startsAt: pastStart,
				endsAt: pastEnd,
				now
			})
		).toThrow('APPOINTMENT_TERMINAL_STATUS');
	});

	it('el paso natural del tiempo no cierra ni agrega un estado al turno', () => {
		expect(APPOINTMENT_STATUSES).toEqual([
			'reserved',
			'confirmed',
			'cancelled',
			'reschedule_requested'
		]);
		expect(() =>
			assertCanTransitionAppointment({
				currentStatus: 'reserved',
				nextStatus: 'reschedule_requested',
				startsAt: pastStart,
				endsAt: pastEnd,
				now
			})
		).not.toThrow();
	});
});

describe('appointment error messages', () => {
	it('maps overlap and domain errors to human messages', () => {
		const overlapMessage = getHumanAppointmentErrorMessage({ code: '23P01' });
		expect(overlapMessage).toContain('al menos uno de los profesionales');
		expect(overlapMessage).toContain('No se reservó a ningún integrante');
		expect(overlapMessage).toContain('elegí otra opción disponible');
		expect(getHumanAppointmentErrorMessage(new Error('PROFESSIONAL_SERVICE_NOT_ASSIGNED'))).toBe(
			'Al menos uno de los profesionales seleccionados no está habilitado para este procedimiento. Volvé al paso del equipo, quitá a ese profesional o asignale el procedimiento desde su configuración.'
		);
		expect(getHumanAppointmentErrorMessage(new Error('PATIENT_BLOCKED'))).toContain(
			'Revisá su ficha'
		);
		expect(getHumanAppointmentErrorMessage(new Error('APPOINTMENT_CREATOR_INVALID'))).toContain(
			'Recargá la agenda'
		);
	});
});

const requestKey = 'a1000000-0000-4000-8000-000000000001';

const createAtomicAppointmentMock = (options: { replayData?: Record<string, unknown> | null } = {}) => {
	const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
	let tableReads = 0;
	const supabase = {
		from: () => {
			tableReads += 1;
			throw new Error('La creación atómica no debe leer ni escribir tablas desde la aplicación');
		},
		rpc: (name: string, payload: Record<string, unknown>) => {
			rpcCalls.push({ name, payload });
			const generated = {
				id: `appointment-${rpcCalls.length}`,
				patient_id: `patient-${rpcCalls.length}`,
				professional_name_snapshot: 'Dra. Uno, Dr. Dos',
				patient_created: payload.p_patient_mode !== 'existing',
				idempotent_replay: false
			};
			return {
				single: async () => ({
					data: generated,
					error: null
				}),
				maybeSingle: async () => ({
					data: Object.hasOwn(options, 'replayData') ? options.replayData : generated,
					error: null
				})
			};
		}
	};
	return {
		supabase: supabase as never,
		rpcCalls,
		getTableReads: () => tableReads
	};
};

describe('patient identity during appointment creation', () => {
    it('commits required declarations with the public reservation through the information wrapper', async () => {
        const {supabase, rpcCalls} = createAtomicAppointmentMock();
        await createManualAppointment(supabase, {
            businessId: 'business-1', patient: {mode:'public', name:'Ana Prueba', phone:'3425048209'},
            serviceId:'service-1', professionalId:'professional-1', startsAt:new Date('2026-07-30T13:00:00Z'),
            source:'public_booking', idempotencyKey:requestKey, internalNote:'Comentario clínico',
            bookingInformation:{schemaHash:'a'.repeat(64),answers:{profile_insurance:'Particular'}}
        });
        expect(rpcCalls[0]).toMatchObject({name:'create_public_booking_with_information',payload:{p_replay_only:false,p_input:{business_id:'business-1',schema_hash:'a'.repeat(64),answers:{profile_insurance:'Particular'},comment:'Comentario clínico',integration_id:null,professional_ids:['professional-1']}}});
    });
	it('consulta la idempotencia sin crear nada y recupera sólo una coincidencia previa', async () => {
		const absent = createAtomicAppointmentMock({ replayData: null });
		const input = {
			businessId: 'business-1',
			ownerId: 'owner-1',
			patient: { mode: 'new' as const, name: 'Juan Pedro', phone: '342 504 8209' },
			serviceId: 'service-1',
			professionalIds: ['professional-1'],
			startsAt: new Date('2026-07-30T13:00:00.000Z'),
			idempotencyKey: requestKey
		};
		await expect(findAppointmentCreationReplay(absent.supabase, input)).resolves.toBeNull();
		expect(absent.rpcCalls[0]?.payload).toMatchObject({ p_replay_only: true });

		const previous = createAtomicAppointmentMock({
			replayData: {
				id: 'appointment-existing',
				patient_id: 'patient-existing',
				confirmation_token: 'token-existing',
				idempotent_replay: true
			}
		});
		await expect(findAppointmentCreationReplay(previous.supabase, input)).resolves.toMatchObject({
			id: 'appointment-existing',
			idempotent_replay: true
		});
	});

	it('dos altas explícitas con el mismo teléfono siguen siendo dos personas distintas', async () => {
		const { supabase, rpcCalls, getTableReads } = createAtomicAppointmentMock();
		await createManualAppointment(supabase, {
			businessId: 'business-1',
			ownerId: 'owner-1',
			patient: { mode: 'new', name: 'Juan Pedro', phone: '342 504 8209' },
			serviceId: 'service-1',
			professionalId: 'professional-1',
			startsAt: new Date('2026-07-30T13:00:00.000Z'),
			idempotencyKey: requestKey
		});
		await createManualAppointment(supabase, {
			businessId: 'business-1',
			ownerId: 'owner-1',
			patient: { mode: 'new', name: 'Carlos', phone: '342 504 8209' },
			serviceId: 'service-1',
			professionalId: 'professional-1',
			startsAt: new Date('2026-07-30T14:00:00.000Z'),
			idempotencyKey: 'a1000000-0000-4000-8000-000000000002'
		});

		expect(getTableReads()).toBe(0);
		expect(rpcCalls.map((call) => call.payload)).toEqual([
			expect.objectContaining({
				p_patient_mode: 'new',
				p_replay_only: false,
				p_patient_id: null,
				p_patient_name: 'Juan Pedro',
				p_patient_phone_e164: '+5493425048209'
			}),
			expect.objectContaining({
				p_patient_mode: 'new',
				p_patient_id: null,
				p_patient_name: 'Carlos',
				p_patient_phone_e164: '+5493425048209'
			})
		]);
	});

	it('una ficha existente se asocia exclusivamente por el patient_id elegido', async () => {
		const { supabase, rpcCalls } = createAtomicAppointmentMock();
		await createManualAppointment(supabase, {
			businessId: 'business-1',
			patient: {
				mode: 'existing',
				patientId: 'patient-selected',
				phone: '342 504 8209',
				updatePhone: true
			},
			serviceId: 'service-1',
			professionalId: 'professional-1',
			startsAt: new Date('2026-07-30T13:00:00.000Z'),
			idempotencyKey: requestKey
		});

		expect(rpcCalls[0]).toMatchObject({
			name: 'create_appointment_with_patient_identity',
			payload: {
				p_patient_mode: 'existing',
				p_patient_id: 'patient-selected',
				p_patient_name: null,
				p_update_existing_phone: true
			}
		});
	});

	it('rechaza antes del RPC mezclar el modo público con una fuente interna', async () => {
		const { supabase, rpcCalls } = createAtomicAppointmentMock();

		await expect(
			createManualAppointment(supabase, {
				businessId: 'business-1',
				patient: { mode: 'public', name: 'Ana Gomez', phone: '351 555 0000' },
				serviceId: 'service-1',
				professionalId: 'professional-1',
				startsAt: new Date('2026-07-30T13:00:00.000Z'),
				idempotencyKey: requestKey
			})
		).rejects.toThrow('PATIENT_MODE_SOURCE_MISMATCH');
		expect(rpcCalls).toHaveLength(0);
	});
});

describe('joint appointment creation', () => {
	it('envía paciente y equipo en una sola operación atómica e idempotente', async () => {
		const { supabase, rpcCalls } = createAtomicAppointmentMock();
		const created = await createJointAppointment(supabase, {
			businessId: 'business-1',
			createdByUserId: 'user-1',
			patient: { mode: 'existing', patientId: 'patient-1' },
			serviceId: 'service-1',
			professionalIds: ['professional-1', 'professional-2'],
			startsAt: new Date('2026-07-30T13:00:00.000Z'),
			ignoreBreak: true,
			idempotencyKey: requestKey
		});

		expect(created.id).toBe('appointment-1');
		expect(rpcCalls[0]).toEqual({
			name: 'create_appointment_with_patient_identity',
			payload: expect.objectContaining({
				p_business_id: 'business-1',
				p_patient_mode: 'existing',
				p_patient_id: 'patient-1',
				p_professional_ids: ['professional-1', 'professional-2'],
				p_ignore_break: true,
				p_source: 'manual',
				p_idempotency_key: requestKey
			})
		});
	});

	it('no llama a la base si falta aceptar la advertencia del teléfono', async () => {
		const { supabase, rpcCalls, getTableReads } = createAtomicAppointmentMock();
		await expect(
			createJointAppointment(supabase, {
				businessId: 'business-1',
				patient: { mode: 'existing', patientId: 'patient-1', phone: '123' },
				serviceId: 'service-1',
				professionalIds: ['professional-1', 'professional-2'],
				startsAt: new Date('2026-07-30T13:00:00.000Z'),
				phoneCommunicationStatus: 'invalid',
				idempotencyKey: requestKey
			})
		).rejects.toThrow('PHONE_WARNING_ACKNOWLEDGEMENT_REQUIRED');
		expect(getTableReads()).toBe(0);
		expect(rpcCalls).toHaveLength(0);
	});

	it('persiste la aceptación explícita y rechaza declarar válido un número inválido', async () => {
		const acknowledged = createAtomicAppointmentMock();
		await createJointAppointment(acknowledged.supabase, {
			businessId: 'business-1',
			patient: { mode: 'existing', patientId: 'patient-1', phone: '123' },
			serviceId: 'service-1',
			professionalIds: ['professional-1', 'professional-2'],
			startsAt: new Date('2026-07-30T13:00:00.000Z'),
			phoneCommunicationStatus: 'invalid',
			phoneWarningAcknowledged: true,
			idempotencyKey: requestKey
		});
		expect(acknowledged.rpcCalls[0]?.payload).toMatchObject({
			p_phone_communication_status: 'invalid',
			p_phone_warning_acknowledged: true
		});

		const forged = createAtomicAppointmentMock();
		await expect(
			createJointAppointment(forged.supabase, {
				businessId: 'business-1',
				patient: { mode: 'existing', patientId: 'patient-1', phone: '123' },
				serviceId: 'service-1',
				professionalIds: ['professional-1', 'professional-2'],
				startsAt: new Date('2026-07-30T13:00:00.000Z'),
				phoneCommunicationStatus: 'valid',
				idempotencyKey: requestKey
			})
		).rejects.toThrow('PHONE_COMMUNICATION_STATUS_MISMATCH');
		expect(forged.rpcCalls).toHaveLength(0);
	});

	it('la reserva pública declara su estrategia sin inferir por teléfono en TypeScript', async () => {
		const { supabase, rpcCalls } = createAtomicAppointmentMock();
		await createJointAppointment(supabase, {
			businessId: 'business-1',
			patient: {
				mode: 'public',
				name: 'Ana Gomez',
				phone: '+598 99 123 456'
			},
			serviceId: 'service-1',
			professionalIds: ['professional-1', 'professional-2'],
			startsAt: new Date('2026-07-30T13:00:00.000Z'),
			source: 'public_booking',
			idempotencyKey: requestKey
		});

		expect(rpcCalls[0]?.payload).toMatchObject({
			p_patient_mode: 'public',
			p_patient_id: null,
			p_source: 'public_booking',
			p_phone_communication_status: 'unknown',
			p_phone_warning_acknowledged: false
		});
	});
});

describe('rescheduleAppointment y versionado de calendario', () => {
	const baseRow = {
		id: 'apt-1',
		service_id: 'svc-1',
		professional_id: 'pro-1',
		starts_at: '2026-06-15T17:30:00.000Z',
		ends_at: '2026-06-15T18:00:00.000Z',
		status: 'confirmed'
	};
	const newStart = new Date('2026-06-20T14:00:00.000Z');

	it('incrementa calendar_sequence y marca pendiente de actualizar si hubo acción', async () => {
		const { supabase, updates } = createRescheduleMock({
			...baseRow,
			calendar_sequence: 1,
			calendar_action_count: 2
		});
		await rescheduleAppointment(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			userId: 'user-1',
			startsAt: newStart,
			now
		});
		expect(updates).toHaveLength(1);
		expect(updates[0].calendar_sequence).toBe(2);
		expect(updates[0].calendar_update_required_at).toBe(now.toISOString());
	});

	it('incrementa sequence pero NO marca actualización si nunca hubo acción', async () => {
		const { supabase, updates } = createRescheduleMock({
			...baseRow,
			calendar_sequence: 0,
			calendar_action_count: 0
		});
		await rescheduleAppointment(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			userId: 'user-1',
			startsAt: newStart,
			now
		});
		expect(updates[0].calendar_sequence).toBe(1);
		expect(updates[0].calendar_update_required_at).toBeNull();
	});

	it('vuelve a respetar el descanso salvo que la nueva reprogramación lo ignore explícitamente', async () => {
		const { supabase, updates } = createRescheduleMock({
			...baseRow,
			ignore_break: true,
			calendar_sequence: 0,
			calendar_action_count: 0
		});
		await rescheduleAppointment(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			userId: 'user-1',
			startsAt: newStart,
			now
		});
		expect(updates[0].ignore_break).toBe(false);
	});

	it('rechaza reprogramar turnos terminales', async () => {
		const { supabase } = createRescheduleMock({
			...baseRow,
			status: 'cancelled',
			calendar_sequence: 0,
			calendar_action_count: 0
		});
		await expect(
			rescheduleAppointment(supabase, {
				businessId: 'biz-1',
				appointmentId: 'apt-1',
				userId: 'user-1',
				startsAt: newStart,
				now
			})
		).rejects.toThrow('APPOINTMENT_CANNOT_RESCHEDULE');
	});

	it('no resucita una cancelación concurrente y devuelve conflicto', async () => {
		const { supabase, updates } = createRescheduleMock(
			{ ...baseRow, calendar_sequence: 0, calendar_action_count: 0 },
			{ updateData: null }
		);
		await expect(
			rescheduleAppointment(supabase, {
				businessId: 'biz-1',
				appointmentId: 'apt-1',
				userId: 'user-1',
				startsAt: newStart,
				now
			})
		).rejects.toThrow('APPOINTMENT_STATUS_CONFLICT');
		expect(updates).toHaveLength(1);
	});
});

describe('transiciones autenticadas concurrentes', () => {
	it('no sobrescribe un cambio de estado que ganó la carrera', async () => {
		vi.mocked(writeAuditLog).mockClear();
		const { supabase, auditRows, updateFilters } = createStatusMock(
			{
				id: 'apt-1',
				starts_at: '2026-06-15T17:30:00.000Z',
				ends_at: '2026-06-15T18:00:00.000Z',
				status: 'reserved'
			},
			{ updateData: null }
		);
		await expect(
			updateAppointmentStatus(supabase, {
				businessId: 'biz-1',
				appointmentId: 'apt-1',
				status: 'cancelled',
				userId: 'user-1',
				now
			})
		).rejects.toThrow('APPOINTMENT_STATUS_CONFLICT');
		expect(updateFilters).toContainEqual(['status', 'reserved']);
		expect(auditRows).toHaveLength(0);
		expect(writeAuditLog).not.toHaveBeenCalled();
	});

	it('registra auditoría sólo después de una transición atómica exitosa', async () => {
		vi.mocked(writeAuditLog).mockClear();
		const { supabase, auditRows, updateFilters } = createStatusMock(
			{
				id: 'apt-1',
				starts_at: '2026-06-15T17:30:00.000Z',
				ends_at: '2026-06-15T18:00:00.000Z',
				status: 'reserved'
			}
		);
		await updateAppointmentStatus(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			status: 'cancelled',
			userId: 'user-1',
			now
		});
		expect(updateFilters).toContainEqual(['status', 'reserved']);
		expect(auditRows).toHaveLength(0);
		expect(writeAuditLog).toHaveBeenCalledOnce();
		expect(writeAuditLog).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ action: 'appointment.cancelled', entityId: 'apt-1' })
		);
	});
});

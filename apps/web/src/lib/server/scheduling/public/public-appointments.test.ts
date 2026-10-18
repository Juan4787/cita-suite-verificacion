import { beforeEach, describe, expect, it, vi } from 'vitest';
const bookingFlags = vi.hoisted(() => ({ BOOKING_INTEGRATIONS_ENABLED: 'false', BOOKING_CONTEXTS_AVAILABLE: 'false' }));
vi.mock('$env/dynamic/private', () => ({ env: bookingFlags }));
beforeEach(() => { bookingFlags.BOOKING_INTEGRATIONS_ENABLED = 'false'; bookingFlags.BOOKING_CONTEXTS_AVAILABLE = 'false'; });
import {
	getPublicAppointmentMessage,
	getPublicTokenErrorMessage,
	loadPublicAppointmentByToken,
	type PublicAppointmentView
} from '$lib/server/scheduling/public/public-appointments';

const appointment = (overrides: Partial<PublicAppointmentView>): PublicAppointmentView => ({
	id: 'appointment-1',
	token: 'token-1',
	status: 'reserved',
	starts_at: '2026-05-14T12:00:00.000Z',
	ends_at: '2026-05-14T12:30:00.000Z',
	service_name_snapshot: 'Consulta',
	professional_name_snapshot: 'Dra. Pérez',
	professional_count: 1,
	is_joint: false,
	calendar_action_status: 'not_offered',
	calendar_action_at: null,
	calendar_action_count: 0,
	calendar_sequence: 0,
	calendar_update_required_at: null,
	business: {
		id: 'business-1',
		name: 'Consultorio',
		slug: 'consultorio',
		phone: null,
		address: null,
		address_instructions: null,
		maps_link: null,
		logo_url: null,
		timezone: 'America/Argentina/Cordoba',
		is_active: true,
		cancellation_policy: null
	},
	patient_name: 'Paciente',
	public_status_label: 'Reservado',
	public_actions_available: true,
	can_confirm: true,
	can_cancel: true,
	can_request_reschedule: true,
	is_past: false,
	...overrides
});

describe('getPublicAppointmentMessage', () => {
	it('devuelve un mensaje público para turnos reservados', () => {
		expect(getPublicAppointmentMessage(appointment({}))).toBe('Tu turno está reservado.');
	});

	it('explica estados cerrados sin exponer datos internos', () => {
		expect(getPublicAppointmentMessage(appointment({ status: 'cancelled', public_status_label: 'Cancelado' }))).toBe(
			'Este turno ya fue cancelado.'
		);
		expect(
			getPublicAppointmentMessage(
				appointment({
					status: 'reschedule_requested',
					public_status_label: 'Quiere reprogramar',
					can_confirm: false,
					can_request_reschedule: false
				})
			)
		).toBe('Recibimos tu pedido de reprogramación. El consultorio lo gestionará.');
	});

	it('bloquea acciones públicas cuando el turno ya pasó o el negocio está inactivo', () => {
		expect(getPublicAppointmentMessage(appointment({ is_past: true }))).toBe('Este turno ya no admite cambios online.');
		expect(
			getPublicAppointmentMessage(
				appointment({
					business: { ...appointment({}).business, is_active: false }
				})
			)
		).toBe('Este turno no admite cambios online en este momento.');
		expect(getPublicAppointmentMessage(appointment({ public_actions_available: false }))).toBe(
			'Este enlace no está disponible en este momento. Contactá al consultorio.'
		);
	});
});

describe('loadPublicAppointmentByToken', () => {
	it('keeps a historical virtual booking correct when new integration bookings are switched off', async () => {
		bookingFlags.BOOKING_CONTEXTS_AVAILABLE = 'true';
		const view = appointment({});
		const rows: Record<string, unknown> = {
			appointments: { ...view, confirmation_token: view.token, businesses: { ...view.business, created_at: '2026-01-01T00:00:00Z', public_booking_enabled: true, address: 'Dirección física', address_instructions: 'Timbre físico', maps_url: 'https://maps.example.test' }, patients: { full_name: 'Ana Prueba' }, appointment_professionals: [{ professional_id: 'professional-1' }] },
			appointment_booking_contexts: { theme_snapshot: 'natalia', modality: 'video', video_instructions_snapshot: 'El consultorio coordina el acceso virtual.' },
			business_subscriptions: { business_id: view.business.id, commercial_access_enabled: true, is_permanent: true, archived_at: null }
		};
		const supabase = { from: (table: string) => { const builder: any = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: rows[table], error: null }) }; return builder; } };
		const result = await loadPublicAppointmentByToken(supabase as never, view.token, new Date('2026-05-01T00:00:00Z'));
		expect(result?.booking_context?.modality).toBe('video');
		expect(result?.business.address).toBeNull();
		expect(result?.business.maps_link).toBeNull();
		expect(result?.business.address_instructions).toBe('El consultorio coordina el acceso virtual.');
		expect(result?.can_cancel).toBe(true);
	});

	it('identifica un equipo por sus asignaciones sin duplicar el turno público', async () => {
		const query = (data: unknown) => {
			const builder: Record<string, unknown> = {};
			builder.eq = () => builder;
			builder.maybeSingle = async () => ({ data, error: null });
			return builder;
		};
		const supabase = {
			from: (table: string) => ({
				select: () => {
					if (table === 'appointments') {
						return query({
							id: 'appointment-joint-1',
							confirmation_token: 'token-joint-1',
							status: 'reserved',
							starts_at: '2026-07-30T12:23:00.000Z',
							ends_at: '2026-07-30T12:53:00.000Z',
							service_name_snapshot: 'Cirugía',
							professional_name_snapshot: 'Dra. Uno, Dr. Dos',
							calendar_action_status: 'not_offered',
							calendar_action_at: null,
							calendar_action_count: 0,
							calendar_sequence: 0,
							calendar_update_required_at: null,
							businesses: {
								id: 'business-1',
								name: 'Consultorio',
								slug: 'consultorio',
								phone: null,
								address: null,
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
							},
							patients: { full_name: 'Paciente Prueba' },
							appointment_professionals: [
								{ professional_id: 'professional-1' },
								{ professional_id: 'professional-2' }
							]
						});
					}
					if (table === 'business_subscriptions') {
						return query({
							id: 'subscription-1',
							business_id: 'business-1',
							commercial_access_enabled: true,
							is_permanent: true,
							subscription_status: 'active',
							paid_until: null,
							grace_until: null,
							restricted_until: null,
							archived_at: null,
							expiration_notice_enabled: false
						});
					}
					throw new Error(`Tabla inesperada: ${table}`);
				}
			})
		};

		const result = await loadPublicAppointmentByToken(
			supabase as never,
			'token-joint-1',
			new Date('2026-07-25T12:00:00.000Z')
		);

		expect(result).toMatchObject({
			id: 'appointment-joint-1',
			professional_count: 2,
			is_joint: true,
			professional_name_snapshot: 'Dra. Uno, Dr. Dos'
		});
	});
});

describe('getPublicTokenErrorMessage', () => {
	it('traduce errores de token a mensajes humanos', () => {
		expect(getPublicTokenErrorMessage(new Error('PUBLIC_TOKEN_NOT_FOUND'))).toBe(
			'El enlace no es válido o ya no está disponible.'
		);
		expect(getPublicTokenErrorMessage(new Error('PUBLIC_TOKEN_APPOINTMENT_PAST'))).toBe(
			'Este turno ya no admite cambios online.'
		);
		expect(getPublicTokenErrorMessage(new Error('PUBLIC_TOKEN_CANCEL_DENIED'))).toBe(
			'Este turno no se puede cancelar desde este enlace.'
		);
		expect(getPublicTokenErrorMessage(new Error('PUBLIC_TOKEN_COMMERCIAL_UNAVAILABLE'))).toBe(
			'Este enlace no está disponible en este momento. Contactá al consultorio.'
		);
		expect(getPublicTokenErrorMessage(new Error('PUBLIC_TOKEN_ACTION_CONFLICT'))).toBe(
			'Este turno cambió mientras lo actualizábamos. Volvé a abrir el enlace y revisá su estado.'
		);
	});

	it('da contexto y siguiente paso para un error de token inesperado', () => {
		const message = getPublicTokenErrorMessage(new Error('UNKNOWN'));
		expect(message).toContain('turno');
		expect(message).toContain('Volvé a abrirlo');
		expect(message).not.toMatch(/PUBLIC_TOKEN_|SQL|HTTP|RPC/);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const bookingFlags = vi.hoisted(() => ({ BOOKING_INTEGRATIONS_ENABLED: 'false', BOOKING_CONTEXTS_AVAILABLE: 'false' }));
vi.mock('$env/dynamic/private', () => ({ env: bookingFlags }));
beforeEach(() => { bookingFlags.BOOKING_INTEGRATIONS_ENABLED = 'false'; bookingFlags.BOOKING_CONTEXTS_AVAILABLE = 'false'; });
import {
	applyPublicAppointmentAction,
	getPublicAppointmentMessage,
	getPublicTokenErrorMessage,
	loadPublicAppointmentByToken,
	loadRebookUrl,
	loadRebookUrls,
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
		cancellation_policy: null,
		whatsapp_contact_phone: null
	},
	patient_name: 'Paciente',
	deposit: null,
	deposit_transfer_details: null,
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

describe('loadPublicAppointmentByToken · WhatsApp del consultorio', () => {
	const load = async (business: { whatsapp_contact_enabled: boolean; whatsapp_phone: string | null }) => {
		const selects: Record<string, string> = {};
		const rows: Record<string, unknown> = {
			appointments: {
				id: 'appointment-1',
				confirmation_token: 'token-1',
				status: 'reserved',
				starts_at: '2026-11-20T13:00:00.000Z',
				ends_at: '2026-11-20T14:00:00.000Z',
				service_name_snapshot: 'Primera consulta',
				professional_name_snapshot: 'Dra. Natalia',
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
					cancellation_policy: null,
					...business
				},
				patients: { full_name: 'Ana Pérez' },
				appointment_professionals: [{ professional_id: 'professional-1' }]
			},
			business_subscriptions: {
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
			}
		};
		const supabase = {
			from: (table: string) => ({
				select: (columns: string) => {
					selects[table] = columns;
					const builder: Record<string, unknown> = {};
					builder.eq = () => builder;
					builder.maybeSingle = async () => ({ data: rows[table], error: null });
					return builder;
				}
			})
		};
		const view = await loadPublicAppointmentByToken(supabase as never, 'token-1', new Date('2026-11-01T12:00:00.000Z'));
		return { view, selects };
	};

	it('lo pide junto con el turno, en la misma consulta', async () => {
		const { selects } = await load({ whatsapp_contact_enabled: true, whatsapp_phone: '+543421234567' });
		expect(selects.appointments).toMatch(/businesses!inner\([^)]*whatsapp_phone[^)]*whatsapp_contact_enabled/);
	});

	it('lo expone normalizado para WhatsApp sólo si el consultorio lo habilitó', async () => {
		const enabled = await load({ whatsapp_contact_enabled: true, whatsapp_phone: '+543421234567' });
		expect(enabled.view?.business.whatsapp_contact_phone).toBe('+5493421234567');

		const disabled = await load({ whatsapp_contact_enabled: false, whatsapp_phone: '+543421234567' });
		expect(disabled.view?.business.whatsapp_contact_phone).toBeNull();
		// El número guardado nunca viaja crudo en la vista pública.
		expect(disabled.view?.business).not.toHaveProperty('whatsapp_phone');
		expect(disabled.view?.business).not.toHaveProperty('whatsapp_contact_enabled');
	});

	it('un número que WhatsApp no puede abrir no se ofrece', async () => {
		const missing = await load({ whatsapp_contact_enabled: true, whatsapp_phone: null });
		expect(missing.view?.business.whatsapp_contact_phone).toBeNull();
		const foreign = await load({ whatsapp_contact_enabled: true, whatsapp_phone: '+59899123456' });
		expect(foreign.view?.business.whatsapp_contact_phone).toBeNull();
	});
});

describe('loadPublicAppointmentByToken · seña', () => {
	const depositRow = (status: string) => ({
		appointment_id: 'appointment-1', status, amount: 40000, currency: 'ARS', request_from: '2026-11-13T03:00:00+00:00',
		due_at: '2026-11-18T13:00:00+00:00', auto_cancel: true, waived_reason: status === 'waived' ? 'staff' : null,
		recorded_at: status === 'paid' ? '2026-11-02T12:00:00+00:00' : null, reminder_opened_at: null,
		expired_at: status === 'expired' ? '2026-11-18T13:05:00+00:00' : null, revision: 2
	});
	const client = (deposit: unknown) => {
		const writes: string[] = [];
		const rows: Record<string, unknown> = {
			appointments: {
				id: 'appointment-1', confirmation_token: 'token-1', status: 'reserved', starts_at: '2026-11-20T13:00:00.000Z',
				ends_at: '2026-11-20T14:00:00.000Z', service_name_snapshot: 'Primera consulta', professional_name_snapshot: 'Dra. Natalia',
				calendar_action_status: 'not_offered', calendar_action_at: null, calendar_action_count: 0, calendar_sequence: 0,
				calendar_update_required_at: null,
				businesses: {
					id: 'business-1', name: 'Consultorio', slug: 'consultorio', phone: null, address: null, address_instructions: null,
					maps_url: null, logo_url: null, timezone: 'America/Argentina/Cordoba', public_booking_enabled: true, is_active: true,
					created_at: '2026-01-01T00:00:00.000Z', min_booking_notice_minutes: 0, max_booking_days_ahead: 30,
					cancellation_policy: null, whatsapp_phone: null, whatsapp_contact_enabled: false,
					deposit_policies: { transfer_details: 'Alias natalia.frutos' }
				},
				patients: { full_name: 'Ana Pérez' },
				appointment_professionals: [{ professional_id: 'professional-1' }],
				appointment_deposits: deposit
			},
			business_subscriptions: {
				id: 'subscription-1', business_id: 'business-1', commercial_access_enabled: true, is_permanent: true,
				subscription_status: 'active', paid_until: null, grace_until: null, restricted_until: null, archived_at: null,
				expiration_notice_enabled: false
			}
		};
		const supabase = {
			from: (table: string) => ({
				select: () => {
					const builder: Record<string, unknown> = {};
					builder.eq = () => builder;
					builder.maybeSingle = async () => ({ data: rows[table], error: null });
					return builder;
				},
				insert: async () => {
					writes.push(`insert:${table}`);
					return { error: null };
				},
				update: () => {
					writes.push(`update:${table}`);
					throw new Error('UNEXPECTED_UPDATE');
				}
			})
		};
		return { supabase: supabase as never, writes };
	};
	const now = new Date('2026-11-01T12:00:00.000Z');

	it('con la seña pendiente muestra cómo transferir y no ofrece «Confirmo que voy»', async () => {
		const view = await loadPublicAppointmentByToken(client(depositRow('pending')).supabase, 'token-1', now);
		expect(view?.deposit).toMatchObject({ status: 'pending', amount: 40000, revision: 2 });
		expect(view?.deposit_transfer_details).toBe('Alias natalia.frutos');
		expect(view?.can_confirm).toBe(false);
		expect(view?.can_cancel).toBe(true);
		expect(view?.can_request_reschedule).toBe(true);
	});

	it('con la seña resuelta no vuelve a mostrar los datos de transferencia', async () => {
		for (const status of ['paid', 'waived', 'expired']) {
			const view = await loadPublicAppointmentByToken(client(depositRow(status)).supabase, 'token-1', now);
			expect(view?.deposit?.status).toBe(status);
			expect(view?.deposit_transfer_details).toBeNull();
		}
		const withoutDeposit = await loadPublicAppointmentByToken(client(null).supabase, 'token-1', now);
		expect(withoutDeposit).toMatchObject({ deposit: null, deposit_transfer_details: null, can_confirm: true });
	});

	it('el enlace no confirma un turno con la seña pendiente, y no toca el turno al rechazarlo', async () => {
		const { supabase, writes } = client(depositRow('pending'));
		await expect(applyPublicAppointmentAction(supabase, { token: 'token-1', action: 'confirm', now })).rejects.toThrow(
			'PUBLIC_TOKEN_DEPOSIT_PENDING'
		);
		expect(writes).not.toContain('update:appointments');
		expect(getPublicTokenErrorMessage(new Error('PUBLIC_TOKEN_DEPOSIT_PENDING'))).toContain('recibe la seña');
		expect(getPublicTokenErrorMessage({ message: 'APPOINTMENT_DEPOSIT_PENDING' })).toContain('recibe la seña');
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

describe('dónde volver a reservar después de la baja por seña', () => {
	const KEY = '0123456789abcdef0123456789abcdef';
	const target = { id: 'appointment-1', business: { id: 'business-1', slug: 'consultorio uno' } };
	// Each read answers with its table's row and records its filters, so the test can check that the
	// integration is looked up inside the same practice.
	const client = (rows: Record<string, unknown>, failing?: string) => {
		const filters: Record<string, Array<[string, unknown]>> = {};
		const reads: string[] = [];
		const supabase = {
			from: (table: string) => {
				reads.push(table);
				filters[table] = [];
				const result = () => failing === table ? { data: null, error: new Error('READ_FAILED') } : { data: rows[table] ?? null, error: null };
				const builder = {
					select: () => builder,
					limit: () => builder,
					in: (column: string, value: unknown) => { filters[table].push([column, value]); return builder; },
					then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
					eq: (column: string, value: unknown) => {
						filters[table].push([column, value]);
						return builder;
					},
					maybeSingle: async () =>
						failing === table ? { data: null, error: new Error('READ_FAILED') } : { data: rows[table] ?? null, error: null }
				};
				return builder;
			}
		};
		return { supabase: supabase as never, filters, reads };
	};

	it('trescientos turnos mixtos requieren sólo tres lecturas y conservan cada destino', async () => {
		bookingFlags.BOOKING_CONTEXTS_AVAILABLE = 'true';
		const ids = Array.from({ length: 300 }, (_, i) => `appointment-${i}`);
		const { supabase, filters, reads } = client({
			appointment_booking_contexts: ids.slice(0, 200).map(appointment_id => ({ appointment_id, integration_id: 'integration-1' })),
			booking_integrations: [{ id: 'integration-1', public_key: KEY, is_active: true }],
			businesses: { public_booking_enabled: true }
		});
		const paths = await loadRebookUrls(supabase, target.business, ids);
		expect(paths.size).toBe(300);
		for (const id of ids.slice(0, 200)) expect(paths.get(id)).toBe(`/embed/v1/${KEY}`);
		for (const id of ids.slice(200)) expect(paths.get(id)).toBe('/reservar/consultorio%20uno');
		expect(Object.keys(filters)).toEqual(['appointment_booking_contexts', 'booking_integrations', 'businesses']);
		expect(reads).toEqual(['appointment_booking_contexts', 'booking_integrations', 'businesses']);
		expect(filters.appointment_booking_contexts).toEqual([['business_id', 'business-1'], ['appointment_id', ids]]);
		expect(filters.booking_integrations).toEqual([['business_id', 'business-1'], ['id', ['integration-1']]]);
	});
	it('una lista vacía no consulta y una ventana fuera de límite se rechaza', async () => {
		const { supabase, filters } = client({});
		await expect(loadRebookUrls(supabase, target.business, [])).resolves.toEqual(new Map());
		await expect(loadRebookUrls(supabase, target.business, Array.from({ length: 301 }, (_, i) => String(i)))).rejects.toThrow('REBOOK_WINDOW_INVALID');
		expect(filters).toEqual({});
	});
	it('vuelve a la integración por la que reservó, buscada dentro del mismo consultorio', async () => {
		bookingFlags.BOOKING_CONTEXTS_AVAILABLE = 'true';
		const { supabase, filters } = client({
			appointment_booking_contexts: [{ appointment_id: 'appointment-1', integration_id: 'integration-1' }],
			booking_integrations: [{ id: 'integration-1', public_key: KEY, is_active: true }]
		});
		await expect(loadRebookUrl(supabase, target)).resolves.toBe(`/embed/v1/${KEY}`);
		expect(filters.appointment_booking_contexts).toEqual([['business_id', 'business-1'], ['appointment_id', ['appointment-1']]]);
		expect(filters.booking_integrations).toEqual([['business_id', 'business-1'], ['id', ['integration-1']]]);
		expect(filters.businesses).toBeUndefined();
	});

	it('con la integración apagada o una clave inválida, la página pública si el consultorio reserva online', async () => {
		bookingFlags.BOOKING_CONTEXTS_AVAILABLE = 'true';
		for (const integration of [{ public_key: KEY, is_active: false }, { public_key: 'no-es-una-clave', is_active: true }]) {
			const { supabase } = client({
				appointment_booking_contexts: [{ appointment_id: 'appointment-1', integration_id: 'integration-1' }],
				booking_integrations: [{ id: 'integration-1', ...integration }],
				businesses: { public_booking_enabled: true }
			});
			await expect(loadRebookUrl(supabase, target)).resolves.toBe('/reservar/consultorio%20uno');
		}
	});

	it('sin integración ni reserva online no inventa un enlace', async () => {
		bookingFlags.BOOKING_CONTEXTS_AVAILABLE = 'true';
		const { supabase } = client({ businesses: { public_booking_enabled: false } });
		await expect(loadRebookUrl(supabase, target)).resolves.toBeNull();
	});

	it('sin contextos de reserva disponibles no los consulta', async () => {
		const { supabase, filters } = client({ businesses: { public_booking_enabled: true } });
		await expect(loadRebookUrl(supabase, target)).resolves.toBe('/reservar/consultorio%20uno');
		expect(filters.appointment_booking_contexts).toBeUndefined();
	});

	it('una lectura fallida es un error, no un enlace equivocado', async () => {
		bookingFlags.BOOKING_CONTEXTS_AVAILABLE = 'true';
		for (const failing of ['appointment_booking_contexts', 'booking_integrations', 'businesses']) {
			const { supabase } = client(
				{ appointment_booking_contexts: [{ appointment_id: 'appointment-1', integration_id: 'integration-1' }], booking_integrations: null },
				failing
			);
			await expect(loadRebookUrl(supabase, target)).rejects.toThrow('READ_FAILED');
		}
	});
});

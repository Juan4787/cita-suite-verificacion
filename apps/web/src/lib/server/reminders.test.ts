import { beforeEach, describe, expect, it, vi } from 'vitest';

const googleCalendarFlag = vi.hoisted(() => ({ enabled: false }));
vi.mock('./google-calendar', () => ({
	isManagedGoogleCalendarEnabled: () => googleCalendarFlag.enabled
}));
import {
	buildAppointmentActivationDelivery,
	buildArgentineWaMeUrl,
	buildReminderWhatsAppMessage,
	buildRescheduleWhatsAppMessage,
	buildWaMeUrl,
	classifyReminderCoverage,
	countTomorrowUncovered,
	hasConfirmedPushSubscription,
	loadReminderCandidates,
	localDayWindowUtc
} from './reminders';
import { publicRescheduleUrl } from './messaging';

const CORDOBA = 'America/Argentina/Cordoba'; // UTC-3, sin DST

beforeEach(() => {
	googleCalendarFlag.enabled = false;
});

it('virtual reminders never direct the patient to the physical consulting room', () => {
	const message = buildReminderWhatsAppMessage({ modality: 'video', patientName: 'Ana Prueba', startsAt: '2026-06-15T17:30:00Z', timezone: CORDOBA, businessName: 'Consultorio prueba', address: 'Dirección física privada', mapsLink: 'https://maps.example.test', token: 'synthetic-token' });
	expect(message).toContain('Modalidad: Virtual');
	expect(message).not.toContain('Dirección física privada');
	expect(message).not.toContain('maps.example.test');
});

describe('localDayWindowUtc', () => {
	// 2026-06-11 02:00 UTC = 2026-06-10 23:00 en Córdoba: el día local NO es el día UTC.
	const now = new Date('2026-06-11T02:00:00.000Z');

	it('hoy: medianoche local correcta aunque el día UTC ya haya cambiado', () => {
		const { start, end } = localDayWindowUtc(now, CORDOBA, 'hoy');
		expect(start.toISOString()).toBe('2026-06-10T03:00:00.000Z');
		expect(end.toISOString()).toBe('2026-06-11T03:00:00.000Z');
	});

	it('mañana: día local siguiente', () => {
		const { start, end } = localDayWindowUtc(now, CORDOBA, 'manana');
		expect(start.toISOString()).toBe('2026-06-11T03:00:00.000Z');
		expect(end.toISOString()).toBe('2026-06-12T03:00:00.000Z');
	});
});

describe('classifyReminderCoverage', () => {
	const base = {
		calendar_action_status: 'not_offered',
		calendar_update_required_at: null,
		has_confirmed_notifications: false,
		has_active_dispatch: false
	};

	it('sin acción de calendario: sin_calendario (offered NO cuenta como cobertura)', () => {
		expect(classifyReminderCoverage(base)).toBe('sin_calendario');
		expect(classifyReminderCoverage({ ...base, calendar_action_status: 'offered' })).toBe('sin_calendario');
	});

	it('iniciar Google, el calendario del teléfono o un ICS cuenta sin afirmar que se guardó', () => {
		for (const calendar_action_status of [
			'clicked_google',
			'clicked_phone_calendar',
			'clicked_ics',
			'downloaded_ics',
			'clicked_outlook'
		]) {
			expect(classifyReminderCoverage({ ...base, calendar_action_status })).toBeNull();
		}
	});

	it('reprogramado tras acción: pendiente_actualizar aunque haya acción previa', () => {
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'clicked_google',
				calendar_update_required_at: '2026-06-10T12:00:00.000Z'
			})
		).toBe('pendiente_actualizar');
	});

	it('notificación confirmada o dispatch automático activo: cubierto', () => {
		expect(classifyReminderCoverage({ ...base, has_confirmed_notifications: true })).toBeNull();
		expect(classifyReminderCoverage({ ...base, has_active_dispatch: true })).toBeNull();
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'clicked_google',
				has_confirmed_notifications: true
			})
		).toBeNull();
	});

	it('solo acepta Google Calendar cuando confirmó la sequence actual', () => {
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'synced_google',
				google_calendar_sync_status: 'active',
				has_current_google_calendar_event: true
			})
		).toBeNull();
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'synced_google',
				google_calendar_sync_status: 'active',
				has_current_google_calendar_event: false
			})
		).toBe('pendiente_actualizar');
	});

	it('no oculta una sincronización fallida ni un indicador Google huérfano', () => {
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'synced_google',
				google_calendar_sync_status: 'needs_reconnect'
			})
		).toBe('sin_calendario');
		expect(
			classifyReminderCoverage({ ...base, calendar_action_status: 'synced_google' })
		).toBe('sin_calendario');
	});

	it('un estado de calendario desconocido no oculta el turno', () => {
		expect(
			classifyReminderCoverage({ ...base, calendar_action_status: 'future_unknown_status' })
		).toBe('sin_calendario');
	});
});

describe('hasConfirmedPushSubscription', () => {
	const checkedAt = '2026-06-11T10:00:00.000Z';
	const checkedDevice = {
		last_test_confirmed_at: checkedAt,
		last_notification_clicked_at: null,
		verification_required_at: null,
		provider_gone_at: null
	};

	it('reutiliza la confirmación positiva del dispositivo mientras siga disponible', () => {
		expect(
			hasConfirmedPushSubscription({
				detached_at: null,
				push_devices: checkedDevice
			})
		).toBe(true);
	});

	it('un vínculo separado o un 404/410 del proveedor no cuenta como cobertura', () => {
		expect(
			hasConfirmedPushSubscription({
				detached_at: '2026-06-11T11:00:00.000Z',
				push_devices: checkedDevice
			})
		).toBe(false);
		expect(
			hasConfirmedPushSubscription({
				detached_at: null,
				push_devices: {
					...checkedDevice,
					provider_gone_at: '2026-06-11T11:00:00.000Z'
				}
			})
		).toBe(false);
	});

	it('una razón técnica no repite la prueba dentro de 48 h y sí exige comprobarla después', () => {
		const row = {
			detached_at: null,
			push_devices: {
				...checkedDevice,
				verification_required_at: '2026-06-11T11:00:00.000Z'
			}
		};
		expect(hasConfirmedPushSubscription(row, new Date('2026-06-13T09:59:59.000Z'))).toBe(true);
		expect(hasConfirmedPushSubscription(row, new Date('2026-06-13T10:00:01.000Z'))).toBe(false);
	});

	it('sin señal positiva el dispositivo todavía no está comprobado', () => {
		expect(
			hasConfirmedPushSubscription({
				detached_at: null,
				push_devices: {
					last_test_confirmed_at: null,
					last_notification_clicked_at: null,
					verification_required_at: checkedAt,
					provider_gone_at: null
				}
			})
		).toBe(false);
	});
});

describe('buildReminderWhatsAppMessage', () => {
	it('arma el mensaje neutral con dirección, maps y link del turno', () => {
		const message = buildReminderWhatsAppMessage({
			patientName: 'Juan Pérez',
			startsAt: '2026-06-15T17:30:00.000Z',
			timezone: CORDOBA,
			businessName: 'Clínica Sabrina',
			address: 'Av. Santa Fe 1234',
			mapsLink: 'https://maps.app.goo.gl/xyz',
			token: 'tok-1'
		});
		expect(message).toContain('Hola Juan Pérez. Te recordamos tu turno el ');
		expect(message).toContain(' a las 14:30 en Clínica Sabrina.');
		expect(message).toContain('Dirección: Av. Santa Fe 1234');
		expect(message).toContain('Cómo llegar: https://maps.app.goo.gl/xyz');
		expect(message).toContain('Ver turno: ');
		expect(message).toContain('/turno/tok-1');
		// neutral: nada clínico
		expect(message).not.toMatch(/extracci|conducto|implante|diagn/i);
	});

	it('omite dirección y maps si faltan', () => {
		const message = buildReminderWhatsAppMessage({
			patientName: 'Ana',
			startsAt: '2026-06-15T17:30:00.000Z',
			timezone: CORDOBA,
			businessName: 'Clínica Sabrina',
			address: null,
			mapsLink: null,
			token: 'tok-2'
		});
		expect(message).not.toContain('Dirección:');
		expect(message).not.toContain('Cómo llegar:');
		expect(message).toContain('Ver turno: ');
	});
});

describe('enlace de activación para un turno creado desde Agenda', () => {
	it('prepara un mensaje neutral y el wa.me con el número argentino normalizado', () => {
		const delivery = buildAppointmentActivationDelivery('0351 15 123-4567', 'tok-activation');

		expect(delivery.phoneE164).toBe('+5493511234567');
		expect(delivery.publicUrl).toMatch(/\/turno\/tok-activation\?creado=1$/);
		expect(delivery.message).toBe(
			`Tu turno quedó reservado.\nActivá acá el recordatorio:\n${delivery.publicUrl}`
		);
		expect(delivery.whatsappUrl).toBe(
			`https://wa.me/5493511234567?text=${encodeURIComponent(delivery.message)}`
		);
		expect(delivery.whatsappWebUrl).toBe(
			`https://web.whatsapp.com/send?phone=5493511234567&text=${encodeURIComponent(delivery.message)}`
		);
		expect(delivery.message).not.toMatch(/consulta|profesional|diagn|tratamiento/i);
	});

	it('conserva el enlace público pero no inventa un destinatario si el teléfono no es seguro', () => {
		const delivery = buildAppointmentActivationDelivery('15 1234567', 'tok-activation');

		expect(delivery.publicUrl).toMatch(/\/turno\/tok-activation\?creado=1$/);
		expect(delivery.phoneE164).toBeNull();
		expect(delivery.whatsappUrl).toBeNull();
		expect(delivery.whatsappWebUrl).toBeNull();
	});

	it('normaliza también el destinatario de los recordatorios manuales', () => {
		const url = buildArgentineWaMeUrl('011 15 1234-5678', 'Recordatorio');
		expect(url).toBe(`https://wa.me/5491112345678?text=${encodeURIComponent('Recordatorio')}`);
		expect(buildArgentineWaMeUrl('+598 99 123 456', 'Recordatorio')).toBeNull();
	});
});

describe('loadReminderCandidates · exclusión por avisos activados', () => {
	const business = {
		id: 'biz-1',
		name: 'Clínica Sabrina',
		timezone: CORDOBA,
		address: 'Av. Santa Fe 1234',
		maps_url: null
	};
	// 'mañana' a las 15:30 Córdoba, dentro de la ventana del día siguiente.
	const now = new Date('2026-06-11T12:00:00.000Z');
	const tomorrowAt = '2026-06-12T18:30:00.000Z'; // 15:30 -03

	const appointmentRow = (id: string) => ({
		id,
		starts_at: tomorrowAt,
		status: 'reserved',
		service_name_snapshot: 'Consulta',
		professional_name_snapshot: 'Dra. Lopez',
		confirmation_token: `tok-${id}`,
		calendar_action_status: 'not_offered',
		calendar_sequence: 0,
		calendar_update_required_at: null,
		whatsapp_reminder_opened_at: null,
		whatsapp_reminder_marked_sent_at: null,
		patients: { id: `pat-${id}`, full_name: `Paciente ${id}`, phone_e164: '+5493510000001', blocked: false }
	});
	const pushCoverageRow = (
		appointmentId: string,
		options: { confirmed?: boolean; detached?: boolean; gone?: boolean } = {}
	) => ({
		appointment_id: appointmentId,
		detached_at: options.detached ? now.toISOString() : null,
		push_devices: {
			last_test_confirmed_at: options.confirmed === false ? null : now.toISOString(),
			last_notification_clicked_at: null,
			verification_required_at: options.confirmed === false ? now.toISOString() : null,
			provider_gone_at: options.gone ? now.toISOString() : null
		}
	});

	// Mock mínimo: from(tabla) entrega el siguiente resultado encolado para esa tabla;
	// toda la cadena de filtros es no-op y la query se resuelve al await (.then).
	const makeSupabase = (queues: Record<string, Array<{ data: unknown; error: unknown }>>) => {
		const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
		const consume = (table: string) => queues[table]?.shift() ?? { data: null, error: null };
		const chainFor = (table: string) => {
			const result = consume(table);
			const chain: any = {};
			for (const method of ['select', 'eq', 'is', 'not', 'in', 'gte', 'lt', 'order']) {
				chain[method] = (...args: unknown[]) => {
					calls.push({ table, method, args });
					return chain;
				};
			}
			chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
			return chain;
		};
		return { from: (table: string) => chainFor(table), calls } as any;
	};

	it('excluye toda suscripción verificada, incluso si tuvo un fallo transitorio', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a'), appointmentRow('b'), appointmentRow('c')], error: null }],
			push_subscriptions: [
				{
					data: [
						pushCoverageRow('a'),
						pushCoverageRow('b')
						// 'c' no tiene suscripción → NO excluido
					],
					error: null
				}
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		const ids = candidates.map((c) => c.appointment_id).sort();
		expect(ids).toEqual(['c']);
		expect(supabase.calls).toContainEqual({
			table: 'message_dispatches',
			method: 'is',
			args: ['superseded_at', null]
		});
	});

	it('mantiene visible el turno sin confirmación aunque exista telemetría displayed', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			push_subscriptions: [
				{ data: [pushCoverageRow('a', { confirmed: false })], error: null }
			],
			push_delivery_attempts: [
				{
					data: [{ subscription_id: 'sub-a', displayed_at: '2026-06-11T11:00:00.000Z' }],
					error: null
				}
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates.map((candidate) => candidate.appointment_id)).toEqual(['a']);
	});

	it('excluye el turno cuando Cita Suite inició la salida al editor directo de Google', async () => {
		const row = { ...appointmentRow('a'), calendar_action_status: 'clicked_google' };
		const supabase = makeSupabase({
			appointments: [{ data: [row], error: null }],
			push_subscriptions: [{ data: [], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates).toEqual([]);
	});

	it('excluye el turno cuando Cita Suite entregó el evento al calendario de iPhone', async () => {
		const row = { ...appointmentRow('a'), calendar_action_status: 'clicked_phone_calendar' };
		const supabase = makeSupabase({
			appointments: [{ data: [row], error: null }],
			push_subscriptions: [{ data: [], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates).toEqual([]);
	});

	it('normaliza 0/15 antes de preparar WhatsApp y conserva la ficha para corregirla', async () => {
		const row = {
			...appointmentRow('a'),
			patients: {
				...appointmentRow('a').patients,
				phone_e164: '+0351151234567'
			}
		};
		const supabase = makeSupabase({
			appointments: [{ data: [row], error: null }],
			push_subscriptions: [{ data: [], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});

		const [candidate] = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidate.patient_id).toBe('pat-a');
		expect(candidate.phone_e164).toBe('+5493511234567');
		expect(candidate.whatsapp_url).toMatch(/^https:\/\/wa\.me\/5493511234567\?text=/);
	});

	it('no fabrica un wa.me si falta el código de área argentino', async () => {
		const row = {
			...appointmentRow('a'),
			patients: {
				...appointmentRow('a').patients,
				phone_e164: '15 1234567'
			}
		};
		const supabase = makeSupabase({
			appointments: [{ data: [row], error: null }],
			push_subscriptions: [{ data: [], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});

		const [candidate] = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidate.patient_id).toBe('pat-a');
		expect(candidate.phone_e164).toBeNull();
		expect(candidate.whatsapp_url).toBeNull();
	});

	it('abrir WhatsApp desde el panel no cuenta como cobertura del paciente', async () => {
		const row = {
			...appointmentRow('a'),
			whatsapp_reminder_opened_at: '2026-06-11T11:30:00.000Z'
		};
		const supabase = makeSupabase({
			appointments: [{ data: [row], error: null }],
			push_subscriptions: [{ data: [], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates.map((candidate) => candidate.appointment_id)).toEqual(['a']);
		expect(candidates[0].whatsapp_opened_at).toBe('2026-06-11T11:30:00.000Z');
	});

	it('un dispositivo comprobado basta aunque coexista un vínculo separado', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			push_subscriptions: [
				{
					data: [
						pushCoverageRow('a', { detached: true }),
						pushCoverageRow('a')
					],
					error: null
				}
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates).toEqual([]);
	});

	it('vuelve a incluir un vínculo separado si no hay otra cobertura', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			push_subscriptions: [
				{ data: [pushCoverageRow('a', { detached: true })], error: null }
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates.map((candidate) => candidate.appointment_id)).toEqual(['a']);
	});

	it('el contador de Agenda usa la misma exclusión por avisos activados', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a'), appointmentRow('b')], error: null }],
			push_subscriptions: [
				{
					data: [
						pushCoverageRow('a'),
						pushCoverageRow('b', { gone: true })
					],
					error: null
				}
			],
			message_dispatches: [{ data: [], error: null }]
		});

		await expect(
			countTomorrowUncovered(supabase, business, { now, pushSubscriptionsSupabase: supabase })
		).resolves.toBe(1);
	});

	it('lista y contador exigen confirmación aunque la telemetría diga displayed', async () => {
		const rows = [
			appointmentRow('sin-cobertura'),
			{ ...appointmentRow('google'), calendar_action_status: 'clicked_google' },
			{ ...appointmentRow('iphone'), calendar_action_status: 'clicked_phone_calendar' },
			appointmentRow('push-confirmado'),
			appointmentRow('push-displayed-sin-confirmar'),
			appointmentRow('push-sin-confirmar')
		];
		const queues = () => ({
			appointments: [{ data: rows, error: null }],
			push_subscriptions: [
				{
					data: [
						{
							...pushCoverageRow('push-confirmado'),
							id: 'sub-confirmado'
						},
						{
							...pushCoverageRow('push-displayed-sin-confirmar', { confirmed: false }),
							id: 'sub-auto'
						},
						{
							...pushCoverageRow('push-sin-confirmar', { confirmed: false }),
							id: 'sub-sin-confirmar'
						}
					],
					error: null
				}
			],
			push_delivery_attempts: [
				{
					data: [
						{
							subscription_id: 'sub-auto',
							displayed_at: '2026-06-11T11:00:00.000Z',
							user_reported_missing_at: null,
							failed_at: null,
							superseded_at: null,
							created_at: '2026-06-11T11:00:00.000Z'
						}
					],
					error: null
				}
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(makeSupabase(queues()), business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: makeSupabase(queues())
		});
		expect(candidates.map((candidate) => candidate.appointment_id)).toEqual([
			'sin-cobertura',
			'push-displayed-sin-confirmar',
			'push-sin-confirmar'
		]);

		const countSupabase = makeSupabase(queues());
		await expect(
			countTomorrowUncovered(countSupabase, business, {
				now,
				pushSubscriptionsSupabase: countSupabase
			})
		).resolves.toBe(3);
	});

	it('excluye un evento Google únicamente cuando la versión vigente fue confirmada', async () => {
		googleCalendarFlag.enabled = true;
		const synced = { ...appointmentRow('a'), calendar_action_status: 'synced_google' };
		const stale = {
			...appointmentRow('b'),
			calendar_action_status: 'synced_google',
			calendar_sequence: 2,
			calendar_update_required_at: '2026-06-11T11:00:00.000Z'
		};
		const supabase = makeSupabase({
			appointments: [{ data: [synced, stale], error: null }],
			push_subscriptions: [{ data: [], error: null }],
			message_dispatches: [{ data: [], error: null }],
			appointment_google_calendar_events: [
				{
					data: [
						{ appointment_id: 'a', sync_status: 'active', synced_sequence: 0 },
						{ appointment_id: 'b', sync_status: 'pending_update', synced_sequence: 1 }
					],
					error: null
				}
			]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates.map((candidate) => [candidate.appointment_id, candidate.coverage])).toEqual([
			['b', 'pendiente_actualizar']
		]);
	});

	it('consulta las notificaciones con el cliente privilegiado, no con la sesión del usuario', async () => {
		googleCalendarFlag.enabled = true;
		const userSupabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});
		const pushSubscriptionsSupabase = makeSupabase({
			push_subscriptions: [
				{ data: [pushCoverageRow('a')], error: null }
			],
			appointment_google_calendar_events: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(userSupabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase
		});

		expect(candidates).toEqual([]);
	});

	it('falla de forma segura si no puede verificar la versión de Google Calendar', async () => {
		googleCalendarFlag.enabled = true;
		const userSupabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});
		const privilegedSupabase = makeSupabase({
			push_subscriptions: [{ data: [], error: null }],
			appointment_google_calendar_events: [
				{ data: null, error: new Error('calendar inaccessible') }
			]
		});

		await expect(
			loadReminderCandidates(userSupabase, business, {
				day: 'manana',
				now,
				pushSubscriptionsSupabase: privilegedSupabase
			})
		).rejects.toThrow('calendar inaccessible');
	});

	it('falla de forma segura si no se puede leer el estado de los avisos', async () => {
		const userSupabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});
		const pushSubscriptionsSupabase = makeSupabase({
			push_subscriptions: [{ data: null, error: new Error('push inaccesible') }]
		});

		await expect(
			loadReminderCandidates(userSupabase, business, {
				day: 'manana',
				now,
				pushSubscriptionsSupabase
			})
		).rejects.toThrow('push inaccesible');
	});

});

describe('buildRescheduleWhatsAppMessage', () => {
	it('arma el aviso neutral con nueva fecha/hora y el enlace privado', () => {
		const message = buildRescheduleWhatsAppMessage({
			patientName: 'Juan Pérez',
			startsAt: '2026-06-20T17:30:00.000Z',
			timezone: CORDOBA,
			businessName: 'Clínica Sabrina',
			rescheduleUrl: 'https://cita.example/turno/tok-1/reprogramado'
		});
		expect(message).toContain('Hola Juan Pérez. Reprogramamos tu turno en Clínica Sabrina.');
		expect(message).toContain('Nueva fecha:');
		expect(message).toContain(' a las 14:30.');
		expect(message).toContain('https://cita.example/turno/tok-1/reprogramado');
		// neutral: nada clínico
		expect(message).not.toMatch(/extracci|conducto|implante|diagn/i);
	});
});

describe('publicRescheduleUrl', () => {
	it('apunta a /turno/<token>/reprogramado', () => {
		expect(publicRescheduleUrl('tok-1')).toMatch(/\/turno\/tok-1\/reprogramado$/);
	});
});

describe('buildWaMeUrl', () => {
	it('usa el número internacional sin + y encodea el mensaje', () => {
		const url = buildWaMeUrl('+5493512345678', 'Hola Juan. Turno mañana, ¿venís?');
		expect(url.startsWith('https://wa.me/5493512345678?text=')).toBe(true);
		expect(url).toContain(encodeURIComponent('¿venís?'));
		expect(url).not.toContain('+549');
	});
});

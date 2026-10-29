import { readChoice } from '$lib/contracts/json';
// Sección Recordatorios: turnos próximos para refuerzo manual por WhatsApp desde
// recepción. `loadReminderList` trae todos los turnos activos del día con su
// cobertura; `loadReminderCandidates` y el aviso de la agenda, sólo los que no
// tienen cobertura registrada. Los cubiertos se muestran aparte para que recepción
// decida si igual manda el recordatorio final de asistencia (campaña de señas y
// avisos, plan aprobado el 29 de octubre de 2026, sección 4.11).
//
// Criterios de cobertura (ver plan, Fase 8):
// - turno activo, dentro de la ventana Hoy/Mañana (TZ del negocio), futuro.
// - sin acción de calendario (not_offered/offered) → "Sin recordatorio confirmado",
//   o reprogramado después de una acción → "Calendario pendiente de actualizar".
// - sin notificación confirmada por la persona y sin dispatch automático activo
//   (pipeline Meta dormida: si algún día se prende, acá no se duplica).
// "offered" NUNCA cuenta como cobertura: solo significa que vio la pantalla.
//
// La cobertura push exige una prueba positiva de interacción: "Sí, la recibí" o un
// clic real en la notificación. `displayed_at` es telemetría útil, pero una web no
// puede comprobar si Android bloqueó globalmente las notificaciones del navegador
// después del handoff; tampoco alcanzan el permiso, guardar un endpoint ni recibir
// un 201 del proveedor. Esta cobertura sólo evita el refuerzo manual: una suscripción
// vigente recibe siempre los avisos automáticos. Para los calendarios, la señal
// observable y suficiente es haber iniciado la entrega o la salida hacia la opción
// elegida: no afirmamos ni intentamos comprobar el guardado dentro de una aplicación
// externa.

import type { CitaSupabaseClient } from '$lib/types/database';
import { bookingContextsAvailable } from '$lib/server/sites/public/booking-integration-flags';
import { BOOKING_MODALITIES, type BookingModality } from '@cita-suite/shared/booking-integration';
import { ACTIVE_APPOINTMENT_STATUSES } from '$lib/utils/appointment-visibility';
import { formatInTimeZone } from '$lib/utils/format';
import { publicAppointmentUrl } from '$lib/server/integrations/public/messaging';
import { resolveMapsUrl } from '$lib/sites/location';
import { normalizeArgentineWhatsAppPhone } from '$lib/utils/phone';
import { buildWaMeUrl, buildWhatsAppWebUrl } from '$lib/utils/whatsapp';
import type { Business } from '$lib/server/access/public/business';
import { isManagedGoogleCalendarEnabled } from '$lib/server/integrations/public/google-calendar';

const ACTIVE_DISPATCH_STATUSES = ['scheduled', 'queued', 'sending', 'sent', 'delivered', 'read'];
const UNCOVERED_CALENDAR_STATUSES = new Set(['not_offered', 'offered']);
const CALENDAR_HANDOFF_STATUSES = new Set([
	'clicked_google',
	'clicked_ics',
	'downloaded_ics',
	'clicked_outlook',
	'clicked_phone_calendar'
]);

import type { ReminderDay, ReminderCoverage, ReminderCandidate, ReminderListItem } from '$lib/scheduling/contracts';
export type { ReminderDay, ReminderCoverage, ReminderCandidate, ReminderListItem } from '$lib/scheduling/contracts';

// --- Ventanas de día en la zona horaria del negocio -------------------------

const tzOffsetMs = (date: Date, timeZone: string) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value])
	);
	const asUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour) % 24,
		Number(parts.minute),
		Number(parts.second)
	);
	return asUtc - date.getTime();
};

const localMidnightUtc = (now: Date, timeZone: string, dayOffset: number): Date => {
	const offset = tzOffsetMs(now, timeZone);
	const local = new Date(now.getTime() + offset);
	const midnightAsUtc = Date.UTC(
		local.getUTCFullYear(),
		local.getUTCMonth(),
		local.getUTCDate() + dayOffset,
		0,
		0,
		0
	);
	// El offset puede cambiar entre `now` y la medianoche buscada (DST en otras
	// regiones); se recalcula sobre la aproximación.
	const approx = new Date(midnightAsUtc - offset);
	return new Date(midnightAsUtc - tzOffsetMs(approx, timeZone));
};

export const localDayWindowUtc = (
	now: Date,
	timeZone: string,
	day: ReminderDay
): { start: Date; end: Date } => {
	const offset = day === 'hoy' ? 0 : 1;
	return {
		start: localMidnightUtc(now, timeZone, offset),
		end: localMidnightUtc(now, timeZone, offset + 1)
	};
};

// --- Mensaje manual de WhatsApp (§48: neutral, sin datos clínicos) -----------

export type ReminderMessageInput = {
	modality?: BookingModality;
	patientName: string;
	startsAt: string;
	timezone: string;
	businessName: string;
	address: string | null;
	mapsLink: string | null;
	token: string;
};

export const buildReminderWhatsAppMessage = (input: ReminderMessageInput): string => {
	const { dateLabel, timeLabel } = formatInTimeZone(input.startsAt, input.timezone);
	const lines = [
		`Hola ${input.patientName}. Te recordamos tu turno el ${dateLabel} a las ${timeLabel} en ${input.businessName}.`,
		''
	];
	if (input.modality === 'video') lines.push('Modalidad: Virtual');
	if (input.modality !== 'video' && input.address) lines.push(`Dirección: ${input.address}`);
	if (input.modality !== 'video' && input.mapsLink) lines.push(`Cómo llegar: ${input.mapsLink}`);
	// Pedirle que avise si no viene libera el horario a tiempo para dárselo a otra persona.
	if (lines.length > 2) lines.push('');
	lines.push(
		'Si no podés venir, avisanos por acá o cancelalo desde el enlace, así le damos el horario a otra persona.',
		`Ver turno: ${publicAppointmentUrl(input.token)}`
	);
	return lines.join('\n');
};

// Los enlaces viven en un módulo puro para que el navegador use exactamente los mismos.
export { buildWaMeUrl, buildWhatsAppWebUrl };

export const buildArgentineWaMeUrl = (
	phone: string | null | undefined,
	message: string
): string | null => {
	const phoneE164 = normalizeArgentineWhatsAppPhone(phone);
	return phoneE164 ? buildWaMeUrl(phoneE164, message) : null;
};

export type AppointmentActivationDelivery = {
	publicUrl: string;
	message: string;
	phoneE164: string | null;
	whatsappUrl: string | null;
	whatsappWebUrl: string | null;
};

export const buildAppointmentActivationDelivery = (
	phone: string | null | undefined,
	token: string
): AppointmentActivationDelivery => {
	const publicUrl = `${publicAppointmentUrl(token)}?creado=1`;
	const message = [
		'Tu turno quedó reservado.',
		'Activá acá el recordatorio:',
		publicUrl
	].join('\n');
	const phoneE164 = normalizeArgentineWhatsAppPhone(phone);
	return {
		publicUrl,
		message,
		phoneE164,
		whatsappUrl: phoneE164 ? buildWaMeUrl(phoneE164, message) : null,
		whatsappWebUrl: phoneE164 ? buildWhatsAppWebUrl(phoneE164, message) : null
	};
};

// --- Mensaje manual de WhatsApp para reprogramación (§48: neutral) -----------

export type RescheduleMessageInput = {
	patientName: string;
	startsAt: string;
	timezone: string;
	businessName: string;
	rescheduleUrl: string;
};

export const buildRescheduleWhatsAppMessage = (input: RescheduleMessageInput): string => {
	const { dateLabel, timeLabel } = formatInTimeZone(input.startsAt, input.timezone);
	return [
		`Hola ${input.patientName}. Reprogramamos tu turno en ${input.businessName}.`,
		`Nueva fecha: ${dateLabel} a las ${timeLabel}.`,
		'',
		`Mirá el detalle actualizado acá: ${input.rescheduleUrl}`
	].join('\n');
};

// --- Clasificación de cobertura (pura, testeable) ----------------------------

export type CoverageInput = {
	calendar_action_status: string;
	calendar_update_required_at: string | null;
	has_confirmed_notifications: boolean;
	has_active_dispatch: boolean;
	google_calendar_sync_status?: string | null;
	has_current_google_calendar_event?: boolean;
};

export const classifyReminderCoverage = (input: CoverageInput): ReminderCoverage | null => {
	if (input.has_confirmed_notifications || input.has_active_dispatch) return null;
	if (input.has_current_google_calendar_event) return null;

	// Si existe un vínculo administrado, manda el estado confirmado por Google y
	// no un click histórico. Solo active + la sequence actual es cobertura real.
	if (input.google_calendar_sync_status) {
		if (
			input.google_calendar_sync_status === 'pending_update' ||
			input.google_calendar_sync_status === 'active' ||
			input.calendar_update_required_at
		) {
			return 'pendiente_actualizar';
		}
		return 'sin_calendario';
	}

	// synced_google sin su vínculo verificable es una inconsistencia segura: el
	// turno vuelve a la lista en vez de ocultarse por un indicador huérfano.
	if (input.calendar_action_status === 'synced_google') {
		return input.calendar_update_required_at ? 'pendiente_actualizar' : 'sin_calendario';
	}
	if (input.calendar_update_required_at) return 'pendiente_actualizar';
	if (UNCOVERED_CALENDAR_STATUSES.has(input.calendar_action_status)) return 'sin_calendario';
	// Para Google, iPhone/ICS y Outlook alcanza con que nuestra ruta haya iniciado
	// la entrega del evento o la salida al editor prearmado. Es la última señal que
	// la web puede observar sin afirmar que la persona tocó "Guardar" afuera.
	if (CALENDAR_HANDOFF_STATUSES.has(input.calendar_action_status)) return null;
	// Un estado futuro o inválido nunca debe ocultar silenciosamente un turno.
	return 'sin_calendario';
};

export type ConfirmedPushSubscriptionInput = {
	detached_at: string | null;
	push_devices:
		| {
				last_test_confirmed_at: string | null;
				last_notification_clicked_at: string | null;
				verification_required_at: string | null;
				provider_gone_at: string | null;
		  }
		| Array<{
				last_test_confirmed_at: string | null;
				last_notification_clicked_at: string | null;
				verification_required_at: string | null;
				provider_gone_at: string | null;
		  }>
		| null;
};

// La cobertura manual es una señal del dispositivo, no del turno. Un cambio
// técnico conserva el bloqueo absoluto de 48 h tras "Sí, la recibí"; fuera de ese
// período debe existir una señal positiva posterior a la razón técnica.
export const hasConfirmedPushSubscription = (
	row: ConfirmedPushSubscriptionInput,
	now: Date = new Date()
): boolean => {
	if (row.detached_at != null) return false;
	const device = Array.isArray(row.push_devices) ? row.push_devices[0] : row.push_devices;
	if (!device || device.provider_gone_at != null) return false;
	const testConfirmedAt = Date.parse(String(device.last_test_confirmed_at ?? ''));
	const clickedAt = Date.parse(String(device.last_notification_clicked_at ?? ''));
	const verificationRequiredAt = Date.parse(String(device.verification_required_at ?? ''));
	const positiveAt = Math.max(
		Number.isFinite(testConfirmedAt) ? testConfirmedAt : Number.NEGATIVE_INFINITY,
		Number.isFinite(clickedAt) ? clickedAt : Number.NEGATIVE_INFINITY
	);
	if (!Number.isFinite(positiveAt)) return false;
	if (!Number.isFinite(verificationRequiredAt) || positiveAt >= verificationRequiredAt) return true;
	return Number.isFinite(testConfirmedAt) && testConfirmedAt >= now.getTime() - 48 * 60 * 60 * 1000;
};

// --- Carga principal ----------------------------------------------------------

const collectReminderItems = async (
	supabase: CitaSupabaseClient,
	business: Pick<Business, 'id' | 'name' | 'timezone' | 'address' | 'maps_url'>,
	options: {
		day: ReminderDay;
		now?: Date;
		// push_subscriptions no otorga acceso a usuarios autenticados. El caller
		// debe pasar un cliente service-role, después de validar el negocio y con
		// los appointment_id ya autorizados por la consulta principal.
		pushSubscriptionsSupabase: CitaSupabaseClient;
	},
	includeCovered: boolean
): Promise<ReminderListItem[]> => {
	const now = options.now ?? new Date();
	const { start, end } = localDayWindowUtc(now, business.timezone, options.day);
	const windowStart = start.getTime() > now.getTime() ? start : now;

	const { data: rows, error } = await supabase
		.from('appointments')
		.select(
			`
			id,
			starts_at,
			status,
			service_name_snapshot,
			professional_name_snapshot,
			confirmation_token,
			calendar_action_status,
			calendar_sequence,
			calendar_update_required_at,
			whatsapp_reminder_opened_at,
			whatsapp_reminder_marked_sent_at,
			patients!inner(id, full_name, phone_e164, blocked)
		`
		)
		.eq('business_id', business.id)
		.in('status', [...ACTIVE_APPOINTMENT_STATUSES])
		.gte('starts_at', windowStart.toISOString())
		.lt('starts_at', end.toISOString())
		.order('starts_at', { ascending: true });
	if (error) throw error;

	const appointments = rows ?? [];
	if (appointments.length === 0) return [];
	const ids = appointments.map((row) => String(row.id));
	const managedGoogleCalendarEnabled = isManagedGoogleCalendarEnabled();

	const [pushResult, dispatchResult, googleCalendarResult, bookingContextResult] = await Promise.all([
		options.pushSubscriptionsSupabase
			.from('push_subscriptions')
			.select(
				'appointment_id, detached_at, push_devices!inner(last_test_confirmed_at, last_notification_clicked_at, verification_required_at, provider_gone_at)'
			)
			.eq('business_id', business.id)
			.in('appointment_id', ids)
			.is('detached_at', null)
			.is('push_devices.provider_gone_at', null),
		supabase
			.from('message_dispatches')
			.select('appointment_id, status')
			.eq('business_id', business.id)
			.eq('type', 'appointment_reminder_24h')
			.in('appointment_id', ids)
			.is('superseded_at', null),
		managedGoogleCalendarEnabled
			? options.pushSubscriptionsSupabase
					.from('appointment_google_calendar_events')
					.select('appointment_id, sync_status, synced_sequence')
					.eq('business_id', business.id)
					.in('appointment_id', ids)
			: Promise.resolve({ data: [], error: null }),
		bookingContextsAvailable()
			? supabase.from('appointment_booking_contexts').select('appointment_id, modality').eq('business_id', business.id).in('appointment_id', ids)
			: Promise.resolve({ data: [], error: null })
	]);
	if (pushResult.error) throw pushResult.error;
	if (dispatchResult.error) throw dispatchResult.error;
	if (googleCalendarResult.error) throw googleCalendarResult.error;
	if (bookingContextResult.error) throw bookingContextResult.error;
	const modalitiesByAppointment = new Map((bookingContextResult.data ?? []).map((row) => [String(row.appointment_id), readChoice(row.modality, BOOKING_MODALITIES, 'reminders.modality')]));
	const pushRows = pushResult.data;
	const dispatchRows = dispatchResult.data;
	const googleCalendarRows = googleCalendarResult.data;

	const confirmedPushAppointments = new Set(
		(pushRows ?? [])
			.filter((row) => hasConfirmedPushSubscription(row, now))
			.map((row) => String(row.appointment_id))
	);
	const dispatched = new Set(
		(dispatchRows ?? [])
			.filter((row) => ACTIVE_DISPATCH_STATUSES.includes(String(row.status)))
			.map((row) => String(row.appointment_id))
	);
	const googleCalendarByAppointment = new Map(
		(googleCalendarRows ?? []).map((row) => [String(row.appointment_id), row])
	);
	const mapsLink = resolveMapsUrl({ address: business.address, maps_url: business.maps_url });

	const items: ReminderListItem[] = [];
	for (const row of appointments) {
		const patient = row.patients;
		if (patient?.blocked) continue;
		const googleCalendar = googleCalendarByAppointment.get(String(row.id));
		const coverage = classifyReminderCoverage({
			calendar_action_status: String(row.calendar_action_status ?? 'not_offered'),
			calendar_update_required_at: row.calendar_update_required_at ?? null,
			has_confirmed_notifications: confirmedPushAppointments.has(String(row.id)),
			has_active_dispatch: dispatched.has(String(row.id)),
			google_calendar_sync_status: googleCalendar?.sync_status
				? String(googleCalendar.sync_status)
				: null,
			has_current_google_calendar_event:
				String(googleCalendar?.sync_status ?? '') === 'active' &&
				Number(googleCalendar?.synced_sequence) === Number(row.calendar_sequence ?? 0)
		});
		// El aviso de la agenda corre en cada carga: no arma mensajes que no va a mostrar.
		if (!coverage && !includeCovered) continue;

		// WhatsApp recibe siempre el móvil argentino canónico. Se recuperan formatos
		// locales 0/15 y valores legados; si falta información no se inventa un wa.me.
		const phone = normalizeArgentineWhatsAppPhone(patient?.phone_e164);
		const patientName = String(patient?.full_name ?? 'Paciente');
		const whatsappUrl = phone
			? buildWaMeUrl(
					phone,
					buildReminderWhatsAppMessage({
						modality: modalitiesByAppointment.get(String(row.id)),						patientName,
						startsAt: String(row.starts_at),
						timezone: business.timezone,
						businessName: business.name,
						address: business.address,
						mapsLink,
						token: String(row.confirmation_token)
					})
				)
			: null;

		items.push({
			appointment_id: String(row.id),
			patient_id: String(patient.id),
			starts_at: String(row.starts_at),
			time_label: formatInTimeZone(String(row.starts_at), business.timezone).timeLabel,
			status: String(row.status),
			service_name: String(row.service_name_snapshot),
			professional_name: String(row.professional_name_snapshot),
			patient_name: patientName,
			coverage: coverage ?? 'aviso_automatico',
			phone_e164: phone,
			whatsapp_url: whatsappUrl,
			whatsapp_opened_at: row.whatsapp_reminder_opened_at ?? null,
			whatsapp_marked_sent_at: row.whatsapp_reminder_marked_sent_at ?? null
		});
	}
	return items;
};

type ReminderLoadOptions = Parameters<typeof collectReminderItems>[2];
type ReminderBusiness = Pick<Business, 'id' | 'name' | 'timezone' | 'address' | 'maps_url'>;

const needsManualReminder = (item: ReminderListItem): item is ReminderCandidate =>
	item.coverage !== 'aviso_automatico';

// Todos los turnos activos del día, con su cobertura: la página de Recordatorios.
export const loadReminderList = (supabase: CitaSupabaseClient, business: ReminderBusiness, options: ReminderLoadOptions) =>
	collectReminderItems(supabase, business, options, true);

// Turnos sin cobertura registrada: la lista de refuerzo y el aviso de la agenda.
export const loadReminderCandidates = async (
	supabase: CitaSupabaseClient,
	business: ReminderBusiness,
	options: ReminderLoadOptions
): Promise<ReminderCandidate[]> =>
	(await collectReminderItems(supabase, business, options, false)).filter(needsManualReminder);

// El aviso de Agenda usa exactamente los mismos criterios que la sección
// Recordatorios. Así no anuncia turnos que ya tienen recordatorio confirmado.
export const countTomorrowUncovered = async (
	supabase: CitaSupabaseClient,
	business: Pick<Business, 'id' | 'name' | 'timezone' | 'address' | 'maps_url'>,
	options: { now?: Date; pushSubscriptionsSupabase: CitaSupabaseClient }
): Promise<number> =>
	(
		await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now: options.now,
			pushSubscriptionsSupabase: options.pushSubscriptionsSupabase
		})
	).length;

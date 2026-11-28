import { FORM_PAGE_REFERRER_POLICY } from '$lib/server/platform/cross-site-form';
import { logServerFailure } from '$lib/server/platform/logging';
import { bookingInformationEnabled } from '$lib/server/patients/public/booking-information';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { getPublicSiteUrl } from '$lib/server/integrations/public/messaging';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import {
	demoPublicAppointment,
	getPublicAppointmentMessage,
	loadRebookUrl,
	type PublicAppointmentView
} from '$lib/server/scheduling/public/public-appointments';
import { canRegisterCalendarAction, markCalendarOffered } from '$lib/server/integrations/public/calendar-tracking';
import { buildPracticeWhatsAppNotice, buildTurnWhatsAppNotices } from '$lib/server/scheduling/public/practice-whatsapp';
import {
	getGoogleCalendarPublicMessage,
	loadGoogleCalendarUiState,
	processAppointmentGoogleCalendarSync,
	requestGoogleCalendarEventDeletion,
	type GoogleCalendarUiState
} from '$lib/server/integrations/public/google-calendar';
import {
	buildAndroidCalendarIntentUrl,
	isAndroidCalendarIntentVariant,
	type AndroidCalendarIntentVariant
} from '$lib/server/integrations/public/android-calendar-intent';
import {
	calendarDescriptionFor,
	calendarLocationFor,
	calendarSummaryFor
} from '$lib/server/integrations/public/calendar-content';
import {
	classifyUserAgent,
	isLikelyBotUserAgent,
	notificationBrowserProfile,
	supportsAndroidCalendarIntent,
	type DeviceClass
} from '$lib/device';
import { fail } from '@sveltejs/kit';
import type { Actions, RequestEvent } from '@sveltejs/kit';
import { loadPatientManagementScreen, submitPatientManagementAction } from './patient-management-flow';
import { loadPatientManagementView, type PatientManagementAccess } from './patient-management';
import type { PatientManagementPanelData } from '$lib/scheduling/patient-management-page';
import { zonedDate } from '$lib/availability/calculate';
import {
	depositPaymentNoticeRateLimitRules,
	enforceRateLimits,
	hashRateLimitSubject,
	rateLimitFail
} from '$lib/server/platform/rate-limits';
import { readBoolean, readRecord, readText } from '$lib/contracts/json';

const managementReadLimit = async (supabase: Awaited<ReturnType<typeof createSupabaseAdminClient>>, event: RequestEvent) => {
 const { data, error } = await supabase.rpc('consume_booking_integration_read_limit', { p_subject_hash: hashRateLimitSubject(event.getClientAddress()) });
 if (error || data !== true) throw new Error('APPOINTMENT_RATE_LIMIT');
};


const SOON_WINDOW_MS = 2 * 60 * 60 * 1000;

const unavailableGoogleCalendarState = (): GoogleCalendarUiState => ({
	available: false,
	state: 'none',
	current: false,
	reminderLabel: 'antes del turno'
});

const isStartingSoon = (appointment: PublicAppointmentView, now: Date) => {
	const remaining = new Date(appointment.starts_at).getTime() - now.getTime();
	return remaining > 0 && remaining <= SOON_WINDOW_MS;
};

// FASE 12 — modo del intent nativo Android: el override de QA `?ci=` gana sobre el
// env (y fuerza el href aun fuera del gate de UA, para correr la matriz de
// dispositivos sin redeploys); sin override rige ANDROID_CALENDAR_INTENT_MODE,
// default off.
const resolveAndroidIntentMode = (
	url: URL
): { variant: AndroidCalendarIntentVariant | null; forced: boolean } => {
	const override = (url.searchParams.get('ci') ?? '').trim().toLowerCase();
	if (override === 'off') return { variant: null, forced: true };
	if (isAndroidCalendarIntentVariant(override)) return { variant: override, forced: true };
	const fromEnv = (env.ANDROID_CALENDAR_INTENT_MODE ?? '').trim().toLowerCase();
	if (isAndroidCalendarIntentVariant(fromEnv)) return { variant: fromEnv, forced: false };
	return { variant: null, forced: false };
};

export type AndroidCalendarIntent = { url: string; variant: AndroidCalendarIntentVariant };

const androidCalendarIntentFor = (
	appointment: PublicAppointmentView | null,
	device: DeviceClass,
	userAgent: string | null,
	url: URL,
 access: PatientManagementAccess
): AndroidCalendarIntent | null => {
	if (!appointment || device !== 'android') return null;
	if (!canRegisterCalendarAction(appointment)) return null;
	const { variant, forced } = resolveAndroidIntentMode(url);
	if (!variant) return null;
	if (!forced && !supportsAndroidCalendarIntent(userAgent)) return null;
	return {
		variant,
		url: buildAndroidCalendarIntentUrl(variant, {
			title: calendarSummaryFor(appointment),
			description: calendarDescriptionFor(appointment),
			location: calendarLocationFor(appointment),
			startsAt: new Date(appointment.starts_at),
			endsAt: new Date(appointment.ends_at),
			// Fallback propio: si el intent no resuelve, Chrome navega acá y el
			// tracking de Google queda registrado server-side con su origen.
			fallbackUrl: `${getPublicSiteUrl()}/${access.legacy ? 'turno' : 'gestion'}/${encodeURIComponent(access.token)}/ir/google?source=android_native_fallback`
		})
	};
};

export const createPatientManagementPage = (legacy: boolean) => {
const load = async (event: RequestEvent) => {
 const { params, fetch, url, request, setHeaders } = event;
 const token = params.token ?? "";
 const access: PatientManagementAccess = { token, legacy };
	// La página expone datos del turno detrás del token: nunca debe quedar cacheada.
	setHeaders({ 'cache-control': 'no-store', 'referrer-policy': FORM_PAGE_REFERRER_POLICY, 'x-robots-tag': 'noindex, nofollow, noarchive' });
	const userAgent = request.headers.get('user-agent');
	const device = classifyUserAgent(userAgent);
	const vapidPublicKey = publicEnv.PUBLIC_VAPID_PUBLIC_KEY?.trim() || env.VAPID_PUBLIC_KEY?.trim() || null;
	const publicSiteUrl = getPublicSiteUrl();
	const notificationBrowser = notificationBrowserProfile(userAgent);

	if (env.DEMO_MODE === 'true') {
		const appointment = demoPublicAppointment(token);
		const created = url.searchParams.has('creado');
  const now = new Date().toISOString();
  const management: PatientManagementPanelData = {
   url: `/${legacy ? 'turno' : 'gestion'}/${token}`, revision: '0'.repeat(64), operationId: crypto.randomUUID(),
   mode: url.searchParams.get('accion') === 'cancelar' ? 'cancel' : url.searchParams.get('accion') === 'reprogramar' ? 'reschedule' : 'overview',
   startsAt: appointment.starts_at, timezone: appointment.business.timezone, now, canCancel: true, canConfirm: true, canReschedule: true,
   date: zonedDate(new Date(now),appointment.business.timezone), slots: [], selectedStart: null, availabilityRevision: null, integrationRevision: null,
   durationMinutes: 30, financialTerms: null, financialSummary: {appliedAmount:'0',forfeitedAmount:'0',unresolvedAmount:'0'}, unavailableMessage: 'La demostración no guarda cambios ni ofrece horarios reales.'
  };
  return { management,
			appointment,
			bookingInformationEnabled: bookingInformationEnabled(),
   remindersEnabled: true,
			message: getPublicAppointmentMessage(appointment),
			created,
			informationSaved: url.searchParams.get('informacion') === 'guardada',
			...buildTurnWhatsAppNotices(appointment, { created }),
			rebookUrl: null,
			suggestedAction: url.searchParams.get('accion') ?? '',
			demo: true,
			device,
			isSoon: false,
			vapidPublicKey,
			publicSiteUrl,
			notificationBrowser,
			androidCalendarIntent: androidCalendarIntentFor(appointment, device, userAgent, url, access),
			googleCalendar: unavailableGoogleCalendarState(),
			calendarMessage: getGoogleCalendarPublicMessage(url.searchParams.get('calendar'))
		};
	}

	try {
		const supabase = await createSupabaseAdminClient('odonto', fetch);
		const now = new Date();
		await managementReadLimit(supabase, event);
  const screen = await loadPatientManagementScreen(supabase, access, url);
  const appointment = screen?.view.appointment ?? null;
  const remindersEnabled = screen?.view.canManageReminders === true;
		let googleCalendar = unavailableGoogleCalendarState();
		if (appointment) {
			try {
				googleCalendar = await loadGoogleCalendarUiState(supabase, appointment, now);
    if (!remindersEnabled) googleCalendar = { ...googleCalendar, available: false };
			} catch (calendarError) {
				// La reserva sigue siendo util aunque el estado auxiliar no pueda cargarse.
				// La opcion administrada se oculta para no prometer una accion incierta.
				logServerFailure('Error cargando estado Google Calendar', {
					appointmentId: appointment.id,
					code:
						calendarError instanceof Error
							? calendarError.message.slice(0, 120)
							: 'unknown'
				});
			}
		}
		if (
			appointment &&
			remindersEnabled && appointment.calendar_action_status === 'not_offered' &&
			!appointment.is_past &&
			appointment.status !== 'cancelled' &&
			!isLikelyBotUserAgent(userAgent)
		) {
			// Best-effort: los previews de WhatsApp/Telegram quedan filtrados por UA.
			await markCalendarOffered(supabase, access);
		}
		const created = url.searchParams.has('creado');
		let rebookUrl: string | null = null;
		if (appointment?.status === 'cancelled' && screen?.view.newBookingAllowed) {
			try {
				rebookUrl = await loadRebookUrl(supabase, appointment);
			} catch (rebookError) {
				// Sin el enlace la página sigue: el botón de WhatsApp queda para volver a reservar.
				logServerFailure('Error resolviendo dónde volver a reservar', rebookError);
			}
		}
		const whatsAppNotices = appointment
			? buildTurnWhatsAppNotices(appointment, { created })
			: { depositWhatsApp: null, practiceWhatsApp: null };
		// P5: dentro de la ventana cerrada, el botón de WhatsApp del bloque «Gestionar mi turno»
		// siempre debe ofrecerse cuando el consultorio tiene WhatsApp activo, incluso si hay seña pendiente.
		const managementWhatsApp = appointment
			? (buildPracticeWhatsAppNotice(appointment, { created: false }) ?? whatsAppNotices.practiceWhatsApp)
			: null;
		const management = screen?.panel
			? {
					...screen.panel,
					practiceWhatsApp: managementWhatsApp
						? {
								whatsappUrl: managementWhatsApp.whatsappUrl,
								whatsappWebUrl: managementWhatsApp.whatsappWebUrl
							}
						: null,
					device
				}
			: null;
		return {
   management,
			appointment,
			bookingInformationEnabled: bookingInformationEnabled() && screen?.view.canAddInformation === true,
   remindersEnabled,
   emailRemindersActive: screen?.view.emailRemindersActive === true,
   // AC04: a message describes the time it was written for. The page always shows the current one.
   scheduleChangedSinceMessage: url.searchParams.has('desde') && screen?.view.scheduleRevision != null
    && url.searchParams.get('desde') !== String(screen.view.scheduleRevision),
			message: appointment ? (appointment.status === 'cancelled' ? 'Este turno ya fue cancelado.' : appointment.is_past ? 'Este turno ya no admite cambios online.' : appointment.status === 'confirmed' ? 'Tu turno está confirmado.' : appointment.status === 'reschedule_requested' ? 'Este turno tiene un pedido de reprogramación pendiente.' : 'Tu turno está reservado.') : 'El enlace no es válido o ya no está disponible.',
			created,
			informationSaved: appointment !== null && url.searchParams.get('informacion') === 'guardada',
			...whatsAppNotices,
			rebookUrl,
			suggestedAction: url.searchParams.get('accion') ?? '',
			demo: false,
			device,
			isSoon: appointment ? isStartingSoon(appointment, now) : false,
			vapidPublicKey,
			publicSiteUrl,
			notificationBrowser,
			androidCalendarIntent: remindersEnabled ? androidCalendarIntentFor(appointment, device, userAgent, url, access) : null,
			googleCalendar,
			calendarMessage: getGoogleCalendarPublicMessage(url.searchParams.get('calendar'), googleCalendar)
		};
	} catch (error) {
		logServerFailure('Error cargando turno publico', error);
		return {
			appointment: null,
   management: null,
			bookingInformationEnabled: false,
   remindersEnabled: false,
			message: 'El enlace no es válido o no está disponible.',
			created: false,
			informationSaved: false,
			depositWhatsApp: null,
			practiceWhatsApp: null,
			rebookUrl: null,
			suggestedAction: '',
			demo: false,
			device,
			isSoon: false,
			vapidPublicKey,
			publicSiteUrl,
			notificationBrowser,
			androidCalendarIntent: null,
			googleCalendar: unavailableGoogleCalendarState(),
			calendarMessage: null
		};
	}
};

const submit = (action: 'confirm' | 'cancel' | 'reschedule') => async (event: RequestEvent) => {
 if (env.DEMO_MODE === 'true') return { success: false, message: 'La demostración no guarda cambios.' };
 const supabase = await createSupabaseAdminClient('odonto', event.fetch);
 try { await managementReadLimit(supabase,event); }
 catch { return fail(429,{ message: 'Hubo varios intentos seguidos. Esperá un minuto y volvé a intentar.' }); }
 const feedback = await submitPatientManagementAction(supabase,{token:event.params.token ?? '',legacy},action,event.request);
 if (!feedback.success) return fail(feedback.retrySameOperation ? 503 : 409,feedback);
 if (feedback.result?.changed) {
  try { await processAppointmentGoogleCalendarSync(supabase,feedback.result.appointmentId,event.fetch); }
  catch (error) { logServerFailure('Error sincronizando calendario tras autogestión',error); }
 }
 return feedback;
};
const actions: Actions = {
 confirm: submit('confirm'), cancel: submit('cancel'), reschedule: submit('reschedule'),
 report_deposit_payment: async (event) => {
  if (env.DEMO_MODE === 'true') {
   return {
    success: true,
    action: 'report_deposit_payment' as const,
    paymentNoticeAt: new Date().toISOString(),
    alreadyRecorded: false,
    message: 'Demostración: avisamos al consultorio que transferiste la seña.'
   };
  }
  const token = event.params.token ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) {
   return fail(404, { action: 'report_deposit_payment' as const, message: 'Este enlace no es válido o ya no está disponible.' });
  }
  const supabase = await createSupabaseAdminClient('odonto', event.fetch);
  try {
   await managementReadLimit(supabase, event);
   await enforceRateLimits(depositPaymentNoticeRateLimitRules(token, event.getClientAddress()), event.fetch);
  } catch (rateError) {
   if (rateError instanceof Error && rateError.message === 'APPOINTMENT_RATE_LIMIT') {
    return fail(429, {
     action: 'report_deposit_payment' as const,
     message: 'Hubo varios intentos seguidos. Esperá un minuto y volvé a intentar.'
    });
   }
   const failure = rateLimitFail(rateError, {
    logContext: 'Error limitando avisos de pago de seña',
    unavailableMessage: 'No pudimos registrar el aviso ahora. Volvé a intentar en unos segundos.'
   });
   return fail(failure.status, { action: 'report_deposit_payment' as const, message: failure.message });
  }
  try {
   const { data, error } = await supabase.rpc('report_appointment_deposit_payment', {
    p_token: token,
    p_legacy: legacy
   });
   if (error) {
    const raw = typeof error.message === 'string' ? error.message : '';
    if (raw.includes('APPOINTMENT_LINK_UNAVAILABLE') || raw.includes('DEPOSIT_NOT_FOUND')) {
     return fail(404, { action: 'report_deposit_payment' as const, message: 'Este enlace o su seña ya no están disponibles.' });
    }
    if (raw.includes('DEPOSIT_NOT_PENDING') || raw.includes('DEPOSIT_APPOINTMENT_CLOSED')) {
     return fail(409, {
      action: 'report_deposit_payment' as const,
      message: 'Esta seña ya no está pendiente. Recargá la página para ver el estado actual del turno.'
     });
    }
    logServerFailure('Error registrando aviso de pago de seña', error);
    return fail(503, {
     action: 'report_deposit_payment' as const,
     message: 'No pudimos registrar tu aviso de pago. Volvé a intentar en unos segundos.'
    });
   }
   const row = readRecord(data, 'depositPaymentNotice');
   const paymentNoticeAt = readText(row.payment_notice_at, 'depositPaymentNotice.paymentNoticeAt');
   const alreadyRecorded = readBoolean(row.already_recorded, 'depositPaymentNotice.alreadyRecorded');
   return {
    success: true,
    action: 'report_deposit_payment' as const,
    paymentNoticeAt,
    alreadyRecorded,
    message: alreadyRecorded
     ? 'Ya teníamos registrado tu aviso de transferencia. El consultorio va a verificar tu pago.'
     : 'Avisamos al consultorio que transferiste la seña. Va a verificar tu pago y confirmar el turno.'
   };
  } catch (err) {
   logServerFailure('Error inesperado registrando aviso de pago de seña', err);
   return fail(503, {
    action: 'report_deposit_payment' as const,
    message: 'No pudimos registrar tu aviso de pago. Volvé a intentar en unos segundos.'
   });
  }
 },
 // Old forms cannot create a manual request or bypass revision/confirmation.
 request_reschedule: async () => fail(409,{ message: 'Revisá el turno y elegí un horario desde «Reprogramar turno».' }),
	remove_google_calendar: async ({ params, fetch }) => {
 const token = params.token ?? "";
		if (env.DEMO_MODE === 'true') {
			return { success: true, message: 'El turno se quitó de tu cuenta Google.' };
		}
		try {
			const supabase = await createSupabaseAdminClient('odonto', fetch);
			const appointment = (await loadPatientManagementView(supabase,{token,legacy}))?.appointment ?? null;
			if (!appointment) {
				return fail(404, { message: 'Este enlace ya no está disponible.' });
			}
			const result = await requestGoogleCalendarEventDeletion(
				supabase,
    { token, legacy },
				fetch
			);
			if (result.status === 'not_connected') return { success: true, message: 'Este turno ya no tiene un calendario conectado.' };
			if (result.status === 'deleted') {
				return { success: true, message: 'El turno se quitó de tu cuenta Google.' };
			}
			if (result.status === 'pending_delete') {
				return { success: true, message: 'Estamos terminando de quitar el turno de tu cuenta Google.' };
			}
			return fail(409, {
				message: 'Elegí nuevamente tu cuenta Google para terminar de quitar el turno.'
			});
		} catch (error) {
			logServerFailure('Error quitando turno de Google Calendar', {
				code: error instanceof Error ? error.message.slice(0, 120) : 'unknown'
			});
			return fail(400, {
				message: 'No pudimos quitarlo en este momento. Volvé a intentar desde este mismo turno.'
			});
		}
	}
};

return { load, actions };
};

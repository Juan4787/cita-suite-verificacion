import { logServerFailure } from '$lib/server/platform/logging';
import { bookingInformationEnabled } from '$lib/server/patients/public/booking-information';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { getPublicSiteUrl } from '$lib/server/integrations/public/messaging';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import {
	applyPublicAppointmentAction,
	demoPublicAppointment,
	getPublicAppointmentMessage,
	getPublicTokenErrorMessage,
	loadPublicAppointmentByToken,
	type PublicAppointmentView
} from '$lib/server/scheduling/public/public-appointments';
import { canRegisterCalendarAction, markCalendarOffered } from '$lib/server/integrations/public/calendar-tracking';
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
import { publicAppointmentUrl } from '$lib/server/integrations/public/messaging';
import {
	classifyUserAgent,
	isLikelyBotUserAgent,
	notificationBrowserProfile,
	supportsAndroidCalendarIntent,
	type DeviceClass
} from '$lib/device';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

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
	url: URL
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
			fallbackUrl: `${publicAppointmentUrl(appointment.token)}/ir/google?source=android_native_fallback`
		})
	};
};

export const load: PageServerLoad = async ({ params, fetch, url, request, setHeaders }) => {
	// La página expone datos del turno detrás del token: nunca debe quedar cacheada.
	setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
	const userAgent = request.headers.get('user-agent');
	const device = classifyUserAgent(userAgent);
	const vapidPublicKey = publicEnv.PUBLIC_VAPID_PUBLIC_KEY?.trim() || env.VAPID_PUBLIC_KEY?.trim() || null;
	const publicSiteUrl = getPublicSiteUrl();
	const notificationBrowser = notificationBrowserProfile(userAgent);

	if (env.DEMO_MODE === 'true') {
		const appointment = demoPublicAppointment(params.token);
		return {
			appointment,
			bookingInformationEnabled: bookingInformationEnabled(),
			message: getPublicAppointmentMessage(appointment),
			created: url.searchParams.has('creado'),
			suggestedAction: url.searchParams.get('accion') ?? '',
			demo: true,
			device,
			isSoon: false,
			vapidPublicKey,
			publicSiteUrl,
			notificationBrowser,
			androidCalendarIntent: androidCalendarIntentFor(appointment, device, userAgent, url),
			googleCalendar: unavailableGoogleCalendarState(),
			calendarMessage: getGoogleCalendarPublicMessage(url.searchParams.get('calendar'))
		};
	}

	try {
		const supabase = await createSupabaseAdminClient('odonto', fetch);
		const now = new Date();
		const appointment = await loadPublicAppointmentByToken(supabase, params.token, now);
		let googleCalendar = unavailableGoogleCalendarState();
		if (appointment) {
			try {
				googleCalendar = await loadGoogleCalendarUiState(supabase, appointment, now);
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
			appointment.calendar_action_status === 'not_offered' &&
			!appointment.is_past &&
			appointment.status !== 'cancelled' &&
			!isLikelyBotUserAgent(userAgent)
		) {
			// Best-effort: los previews de WhatsApp/Telegram quedan filtrados por UA.
			await markCalendarOffered(supabase, appointment, now);
		}
		return {
			appointment,
			bookingInformationEnabled: bookingInformationEnabled(),
			message: getPublicAppointmentMessage(appointment),
			created: url.searchParams.has('creado'),
			suggestedAction: url.searchParams.get('accion') ?? '',
			demo: false,
			device,
			isSoon: appointment ? isStartingSoon(appointment, now) : false,
			vapidPublicKey,
			publicSiteUrl,
			notificationBrowser,
			androidCalendarIntent: androidCalendarIntentFor(appointment, device, userAgent, url),
			googleCalendar,
			calendarMessage: getGoogleCalendarPublicMessage(url.searchParams.get('calendar'))
		};
	} catch (error) {
		logServerFailure('Error cargando turno publico', error);
		return {
			appointment: null,
			bookingInformationEnabled: false,
			message: 'El enlace no es válido o no está disponible.',
			created: false,
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

export const actions: Actions = {
	confirm: async ({ params, fetch, request, getClientAddress }) => {
		if (env.DEMO_MODE === 'true') return { success: true, message: 'Turno confirmado.' };
		try {
			const supabase = await createSupabaseAdminClient('odonto', fetch);
			await applyPublicAppointmentAction(supabase, {
				token: params.token,
				action: 'confirm',
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
			return { success: true, message: 'Turno confirmado.' };
		} catch (error) {
			logServerFailure('Error confirmando turno publico', error);
			return fail(400, { message: getPublicTokenErrorMessage(error) });
		}
	},
	cancel: async ({ params, fetch, request, getClientAddress }) => {
		if (env.DEMO_MODE === 'true') return { success: true, message: 'Turno cancelado.' };
		const form = await request.formData();
		if (form.get('confirm_cancel') !== 'true') {
			return fail(400, { message: 'Confirmá que querés cancelar el turno.' });
		}
		try {
			const supabase = await createSupabaseAdminClient('odonto', fetch);
			const result = await applyPublicAppointmentAction(supabase, {
				token: params.token,
				action: 'cancel',
				note: String(form.get('note') ?? '').trim() || null,
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
			if (result.changed) {
				try {
					await processAppointmentGoogleCalendarSync(supabase, result.appointment.id, fetch);
				} catch (calendarError) {
					// La cola durable conserva el borrado para el próximo reintento.
					logServerFailure('Error sincronizando Google Calendar tras cancelar', {
						appointmentId: result.appointment.id,
						code:
							calendarError instanceof Error
								? calendarError.message.slice(0, 120)
								: 'unknown'
					});
				}
			}
			return { success: true, message: 'Turno cancelado.' };
		} catch (error) {
			logServerFailure('Error cancelando turno publico', error);
			return fail(400, { message: getPublicTokenErrorMessage(error) });
		}
	},
	request_reschedule: async ({ params, fetch, request, getClientAddress }) => {
		if (env.DEMO_MODE === 'true') return { success: true, message: 'Pedido de reprogramación recibido.' };
		const form = await request.formData();
		try {
			const supabase = await createSupabaseAdminClient('odonto', fetch);
			await applyPublicAppointmentAction(supabase, {
				token: params.token,
				action: 'reschedule',
				note: String(form.get('note') ?? '').trim() || null,
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
			return { success: true, message: 'Pedido de reprogramación recibido.' };
		} catch (error) {
			logServerFailure('Error solicitando reprogramacion publica', error);
			return fail(400, { message: getPublicTokenErrorMessage(error) });
		}
	},
	remove_google_calendar: async ({ params, fetch }) => {
		if (env.DEMO_MODE === 'true') {
			return { success: true, message: 'El turno se quitó de tu cuenta Google.' };
		}
		try {
			const supabase = await createSupabaseAdminClient('odonto', fetch);
			const appointment = await loadPublicAppointmentByToken(supabase, params.token);
			if (!appointment) {
				return fail(404, { message: 'Este enlace ya no está disponible.' });
			}
			const result = await requestGoogleCalendarEventDeletion(
				supabase,
				appointment.id,
				fetch
			);
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

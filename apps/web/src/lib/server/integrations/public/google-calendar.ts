import { logServerFailure } from '$lib/server/platform/logging';
import {
	InvalidDataContractError,
	isRecord,
	readArray,
	readChoice,
	readFiniteNumber,
	readNullableText,
	readRecord,
	readText
} from '$lib/contracts/json';
import { env } from '$env/dynamic/private';
import type { CitaRow, CitaSupabaseClient } from '$lib/types/database';
import crypto from 'node:crypto';
import {
	calendarDescriptionFor,
	calendarLocationFor,
	calendarSummaryFor,
	type CalendarEventAppointment
} from '$lib/server/integrations/public/calendar-content';
import { alarmsForProximity } from '$lib/server/integrations/public/ics';
import { getPublicSiteUrl } from '$lib/server/integrations/public/messaging';
import {
	MAX_CONCURRENT_EXTERNAL_CALLS,
	type ScheduledJobRun
} from '$lib/server/integrations/internal/job-budget';
import { isAppointmentStatus } from '$lib/server/scheduling/public/appointments';
import {
	loadPublicAppointmentByToken,
	publicAppointmentPlace,
	type PublicAppointmentView
} from '$lib/server/scheduling/public/public-appointments';
import { bookingContextsAvailable } from '$lib/server/sites/public/booking-integration-flags';
import {
	readAppointmentBookingContext,
	type AppointmentBookingContext
} from '$lib/server/sites/public/booking-integrations';
import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';

const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_TOKEN_REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
type GoogleCalendarSecretPurpose = 'refresh_token' | 'oauth_verifier';
const SECRET_AAD: Record<GoogleCalendarSecretPurpose, Buffer> = {
	refresh_token: Buffer.from('cita-suite/google-calendar/refresh-token/v1'),
	oauth_verifier: Buffer.from('cita-suite/google-calendar/oauth-verifier/v1')
};
const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const GOOGLE_REQUEST_TIMEOUT_MS = 12_000;

export const GOOGLE_CALENDAR_PENDING_STATUSES = [
	'pending_create',
	'pending_update',
	'pending_delete'
] as const;

const isPendingGoogleCalendarStatus = (
	status: string
): status is (typeof GOOGLE_CALENDAR_PENDING_STATUSES)[number] =>
	(GOOGLE_CALENDAR_PENDING_STATUSES as readonly string[]).includes(status);

const GOOGLE_CALENDAR_SYNC_STATUSES = [
	...GOOGLE_CALENDAR_PENDING_STATUSES,
	'active',
	'deleted',
	'detached',
	'needs_reconnect',
	'failed'
] as const;

export type GoogleCalendarSyncStatus = (typeof GOOGLE_CALENDAR_SYNC_STATUSES)[number];

export type GoogleCalendarUiState = {
	available: boolean;
	state:
		| 'none'
		| 'preparing'
		| 'active'
		| 'updating'
		| 'removing'
		| 'removed'
		| 'needs_reconnect'
		| 'failed';
	current: boolean;
	reminderLabel: string;
};

type GoogleCalendarConfig = {
	clientId: string;
	clientSecret: string;
	clientKey: string;
	redirectUri: string;
	encryptionKey: Buffer;
};

type GoogleTokenResponse = {
	access_token?: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
	token_type?: string;
	error?: string;
};

export type OAuthAttempt = {
	attemptId: string;
	businessId: string;
	appointmentId: string;
	codeVerifier: string;
	forceConsent: boolean;
};

type EventLinkRow = {
	id: string;
	business_id: string;
	appointment_id: string;
	connection_id: string;
	calendar_id: string;
	event_id: string | null;
	sync_status: GoogleCalendarSyncStatus;
	synced_sequence: number;
	attempt_count: number;
	claimed_at: string | null;
};

type ConnectionRow = {
	id: string;
	refresh_token_ciphertext: string | null;
	revoked_at: string | null;
};

type GoogleCalendarFailureCategory = 'transient' | 'authorization' | 'missing' | 'permanent';

export class GoogleCalendarConfigurationError extends Error {
	constructor() {
		super('GOOGLE_CALENDAR_NOT_CONFIGURED');
		this.name = 'GoogleCalendarConfigurationError';
	}
}

class GoogleCalendarRemoteError extends Error {
	constructor(
		readonly category: GoogleCalendarFailureCategory | 'conflict',
		readonly safeCode: string,
		readonly httpStatus?: number
	) {
		super(safeCode);
		this.name = 'GoogleCalendarRemoteError';
	}
}

const trimmed = (value?: string | null) => value?.trim() || null;

export const isManagedGoogleCalendarEnabled = (): boolean =>
	env.GOOGLE_CALENDAR_MANAGED_ENABLED === 'true';

export const parseGoogleCalendarEncryptionKey = (raw: string): Buffer => {
	const value = raw.trim();
	let key: Buffer;
	if (/^[0-9a-f]{64}$/i.test(value)) {
		key = Buffer.from(value, 'hex');
	} else {
		if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
			throw new GoogleCalendarConfigurationError();
		}
		const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
		key = Buffer.from(normalized, 'base64');
	}
	if (key.length !== 32) throw new GoogleCalendarConfigurationError();
	return key;
};

const readGoogleCalendarConfig = (): GoogleCalendarConfig | null => {
	if (!isManagedGoogleCalendarEnabled()) return null;
	// Cliente dedicado: no se reutiliza el OAuth público de Drive. Así una
	// revocación del calendario nunca corta el acceso del consultorio a archivos.
	const clientId = trimmed(env.GOOGLE_CALENDAR_CLIENT_ID);
	const clientSecret = trimmed(env.GOOGLE_CALENDAR_CLIENT_SECRET);
	const encryptionKeyRaw = trimmed(env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY);
	if (!clientId || !clientSecret || !encryptionKeyRaw) return null;

	let encryptionKey: Buffer;
	try {
		encryptionKey = parseGoogleCalendarEncryptionKey(encryptionKeyRaw);
	} catch {
		return null;
	}

	const redirectUri =
		trimmed(env.GOOGLE_CALENDAR_REDIRECT_URI) ??
		`${getPublicSiteUrl()}/oauth/google-calendar/callback`;
	try {
		const parsed = new URL(redirectUri);
		const localHttp =
			parsed.protocol === 'http:' &&
			['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
		if (parsed.protocol !== 'https:' && !localHttp) return null;
	} catch {
		return null;
	}

	return {
		clientId,
		clientSecret,
		clientKey: crypto.createHash('sha256').update(clientId).digest('hex'),
		redirectUri,
		encryptionKey
	};
};

const requireGoogleCalendarConfig = (): GoogleCalendarConfig => {
	const config = readGoogleCalendarConfig();
	if (!config) throw new GoogleCalendarConfigurationError();
	return config;
};

export const isGoogleCalendarConfigured = (): boolean => Boolean(readGoogleCalendarConfig());

const base64url = (value: Buffer): string => value.toString('base64url');

export const encryptGoogleCalendarSecret = (
	plaintext: string,
	key: Buffer,
	purpose: GoogleCalendarSecretPurpose = 'refresh_token'
): string => {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(SECRET_AAD[purpose]);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `v1.${base64url(iv)}.${base64url(tag)}.${base64url(ciphertext)}`;
};

export const decryptGoogleCalendarSecret = (
	serialized: string,
	key: Buffer,
	purpose: GoogleCalendarSecretPurpose = 'refresh_token'
): string => {
	const [version, ivRaw, tagRaw, ciphertextRaw, ...extra] = serialized.split('.');
	if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw || extra.length > 0) {
		throw new Error('GOOGLE_CALENDAR_SECRET_INVALID');
	}
	try {
		const decipher = crypto.createDecipheriv(
			'aes-256-gcm',
			key,
			Buffer.from(ivRaw, 'base64url')
		);
		decipher.setAAD(SECRET_AAD[purpose]);
		decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
		return Buffer.concat([
			decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
			decipher.final()
		]).toString('utf8');
	} catch {
		throw new Error('GOOGLE_CALENDAR_SECRET_INVALID');
	}
};

const stateHash = (state: string): string =>
	crypto.createHash('sha256').update(state).digest('hex');

const isValidOAuthState = (state: string): boolean => /^[A-Za-z0-9_-]{32,180}$/.test(state);

export const createGoogleCalendarAuthorizationUrl = async (
	supabase: CitaSupabaseClient,
	appointment: PublicAppointmentView,
	options: { forceConsent?: boolean; now?: Date } = {}
): Promise<string> => {
	const config = requireGoogleCalendarConfig();
	const now = options.now ?? new Date();
	if (
		appointment.is_past ||
		!['reserved', 'confirmed', 'reschedule_requested'].includes(appointment.status)
	) {
		throw new Error('GOOGLE_CALENDAR_APPOINTMENT_NOT_ACTIVE');
	}

	const state = base64url(crypto.randomBytes(32));
	const codeVerifier = base64url(crypto.randomBytes(48));
	const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
	const expiresAt = new Date(now.getTime() + OAUTH_ATTEMPT_TTL_MS);

	// Limpieza acotada y best-effort; una falla no debilita el state nuevo.
	try {
		await supabase
			.from('google_calendar_oauth_attempts')
			.delete()
			.lt('expires_at', now.toISOString());
	} catch {
		// El indice por expires_at mantiene barata la limpieza del intento siguiente.
	}

	const { error } = await supabase.from('google_calendar_oauth_attempts').insert({
		business_id: appointment.business.id,
		appointment_id: appointment.id,
		state_hash: stateHash(state),
		code_verifier_ciphertext: encryptGoogleCalendarSecret(
			codeVerifier,
			config.encryptionKey,
			'oauth_verifier'
		),
		force_consent: Boolean(options.forceConsent),
		expires_at: expiresAt.toISOString(),
		created_at: now.toISOString()
	});
	if (error) throw error;

	const params = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		response_type: 'code',
		scope: `openid ${GOOGLE_CALENDAR_SCOPE}`,
		access_type: 'offline',
		state,
		code_challenge: codeChallenge,
		code_challenge_method: 'S256',
		// El consentimiento forzado se reserva para una reconexión explícita. En el
		// alta normal, access_type=offline entrega el refresh token la primera vez y
		// las autorizaciones ya guardadas se reutilizan sin repetir esa pantalla.
		prompt: options.forceConsent ? 'consent select_account' : 'select_account'
	});
	return `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`;
};

export const consumeGoogleCalendarOAuthAttempt = async (
	supabase: CitaSupabaseClient,
	state: string,
	now = new Date()
): Promise<OAuthAttempt> => {
	// Impide que un callback histórico reactive el flujo mientras el producto lo
	// mantiene fuera de servicio. Las tablas y el código quedan intactos.
	requireGoogleCalendarConfig();
	if (!isValidOAuthState(state)) throw new Error('GOOGLE_CALENDAR_OAUTH_STATE_INVALID');
	const { data, error } = await supabase.rpc('consume_google_calendar_oauth_attempt', {
		p_state_hash: stateHash(state),
		p_now: now.toISOString()
	});
	if (error) throw error;
	const row = Array.isArray(data) ? data[0] : data;
	if (!row) throw new Error('GOOGLE_CALENDAR_OAUTH_STATE_INVALID');
	const config = requireGoogleCalendarConfig();
	return {
		attemptId: String(row.attempt_id),
		businessId: String(row.business_id),
		appointmentId: String(row.appointment_id),
		codeVerifier: decryptGoogleCalendarSecret(
			String(row.code_verifier_ciphertext),
			config.encryptionKey,
			'oauth_verifier'
		),
		forceConsent: Boolean(row.force_consent)
	};
};

const timeoutSignal = (milliseconds: number) => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), milliseconds);
	return { signal: controller.signal, clear: () => clearTimeout(timeout) };
};

const safeJson = async (response: Response): Promise<unknown> => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const postGoogleToken = async (
	params: URLSearchParams,
	fetchFn: typeof fetch
): Promise<GoogleTokenResponse & { access_token: string }> => {
	const timer = timeoutSignal(GOOGLE_REQUEST_TIMEOUT_MS);
	try {
		const response = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: params,
			signal: timer.signal
		});
		const payload = await safeJson(response);
		const body = isRecord(payload) ? payload : null;
		if (!response.ok || typeof body?.access_token !== 'string' || !body.access_token) {
			if (body?.error === 'invalid_grant') {
				throw new GoogleCalendarRemoteError('authorization', 'oauth_revoked', response.status);
			}
			if (
				body?.error === 'invalid_client' ||
				body?.error === 'unauthorized_client' ||
				(response.status === 401 && !body?.error)
			) {
				// Es una condición global del cliente OAuth, no una decisión de esta
				// persona. Conservamos su autorización y reintentamos sin pedirle nada.
				throw new GoogleCalendarRemoteError('transient', 'oauth_client_unavailable', response.status);
			}
			if (response.status === 429 || response.status >= 500) {
				throw new GoogleCalendarRemoteError('transient', 'oauth_unavailable', response.status);
			}
			throw new GoogleCalendarRemoteError('permanent', 'oauth_rejected', response.status);
		}
    return {
      access_token: body.access_token,
      refresh_token: readNullableText(body.refresh_token, 'googleToken.refreshToken') ?? undefined,
      scope: readNullableText(body.scope, 'googleToken.scope') ?? undefined,
      token_type: readNullableText(body.token_type, 'googleToken.tokenType') ?? undefined,
      ...(body.expires_in === undefined ? {} : { expires_in: readFiniteNumber(body.expires_in, 'googleToken.expiresIn') })
    };
	} catch (error) {
		if (error instanceof GoogleCalendarRemoteError) throw error;
		throw new GoogleCalendarRemoteError('transient', 'oauth_network');
	} finally {
		timer.clear();
	}
};

const exchangeAuthorizationCode = async (
	code: string,
	codeVerifier: string,
	fetchFn: typeof fetch
): Promise<GoogleTokenResponse & { access_token: string }> => {
	const config = requireGoogleCalendarConfig();
	const params = new URLSearchParams({
		client_id: config.clientId,
		client_secret: config.clientSecret,
		code,
		code_verifier: codeVerifier,
		grant_type: 'authorization_code',
		redirect_uri: config.redirectUri
	});
	return postGoogleToken(params, fetchFn);
};

const loadGoogleSubject = async (accessToken: string, fetchFn: typeof fetch): Promise<string> => {
	const timer = timeoutSignal(GOOGLE_REQUEST_TIMEOUT_MS);
	try {
		const response = await fetchFn(GOOGLE_USERINFO_ENDPOINT, {
			headers: { authorization: `Bearer ${accessToken}` },
			signal: timer.signal
		});
		const payload = await safeJson(response);
		const body = isRecord(payload) ? payload : null;
		if (!response.ok || typeof body?.sub !== 'string' || !body.sub) {
			if (response.status === 401) {
				throw new GoogleCalendarRemoteError('authorization', 'oauth_identity_rejected', 401);
			}
			throw new GoogleCalendarRemoteError(
				response.status >= 500 ? 'transient' : 'permanent',
				'oauth_identity_unavailable',
				response.status
			);
		}
		return body.sub;
	} catch (error) {
		if (error instanceof GoogleCalendarRemoteError) throw error;
		throw new GoogleCalendarRemoteError('transient', 'oauth_identity_network');
	} finally {
		timer.clear();
	}
};

export const authorizeGoogleCalendarAppointment = async (
	supabase: CitaSupabaseClient,
	attempt: OAuthAttempt,
	code: string,
	fetchFn: typeof fetch
): Promise<{ appointmentId: string; eventRowId: string; accessToken: string }> => {
	if (!code || code.length > 4096) throw new Error('GOOGLE_CALENDAR_OAUTH_CODE_INVALID');
	const config = requireGoogleCalendarConfig();
	const token = await exchangeAuthorizationCode(code, attempt.codeVerifier, fetchFn);
	const grantedScopes = String(token.scope ?? '')
		.split(/\s+/)
		.map((scope) => scope.trim())
		.filter(Boolean);
	if (!grantedScopes.includes(GOOGLE_CALENDAR_SCOPE)) {
		throw new GoogleCalendarRemoteError('authorization', 'calendar_scope_missing');
	}
	const googleSubject = await loadGoogleSubject(token.access_token, fetchFn);
	const googleSubjectKey = crypto
		.createHash('sha256')
		.update(`${config.clientKey}:${googleSubject}`)
		.digest('hex');
	const refreshCiphertext = token.refresh_token
		? encryptGoogleCalendarSecret(token.refresh_token, config.encryptionKey)
		: null;

	const { data, error } = await supabase.rpc('authorize_google_calendar_event', {
		p_appointment_id: attempt.appointmentId,
		p_oauth_client_key: config.clientKey,
		p_google_subject: googleSubjectKey,
		p_refresh_token_ciphertext: refreshCiphertext,
		p_granted_scopes: grantedScopes,
		p_now: new Date().toISOString()
	});
	if (error) throw error;
	const row = Array.isArray(data) ? data[0] : data;
	if (!row?.event_row_id) throw new Error('GOOGLE_CALENDAR_EVENT_LINK_NOT_CREATED');
	return {
		appointmentId: attempt.appointmentId,
		eventRowId: String(row.event_row_id),
		accessToken: token.access_token
	};
};

const reminderMinutesFromTrigger = (trigger: string): number | null => {
	const match = /^-PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(trigger);
	if (!match) return null;
	return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
};

export const googleCalendarReminderMinutes = (startsAt: Date, now: Date): number[] =>
	alarmsForProximity(startsAt, now)
		.map((alarm) => reminderMinutesFromTrigger(alarm.trigger))
		.filter((minutes): minutes is number => minutes !== null && minutes >= 0);

export const googleCalendarReminderLabel = (startsAt: Date, now = new Date()): string => {
	const minutes = googleCalendarReminderMinutes(startsAt, now);
	if (minutes.includes(1440) && minutes.includes(120)) return '24 horas y 2 horas antes';
	if (minutes.includes(120)) return '2 horas antes';
	if (minutes.includes(30)) return '30 minutos antes';
	return 'con el horario guardado';
};

export const googleCalendarEventResource = (
	appointment: CalendarEventAppointment,
	now = new Date()
) => ({
	summary: calendarSummaryFor(appointment),
	description: calendarDescriptionFor(appointment),
	location: calendarLocationFor(appointment) ?? undefined,
	start: {
		dateTime: appointment.starts_at,
		timeZone: appointment.business.timezone
	},
	end: {
		dateTime: appointment.ends_at,
		timeZone: appointment.business.timezone
	},
	visibility: 'private',
	transparency: 'opaque',
	reminders: {
		useDefault: false,
		overrides: googleCalendarReminderMinutes(new Date(appointment.starts_at), now).map(
			(minutes) => ({ method: 'popup', minutes })
		)
	},
	extendedProperties: {
		private: {
			citaSuiteSequence: String(appointment.calendar_sequence)
		}
	}
});

export const deterministicGoogleCalendarEventId = (appointmentId: string): string =>
	`cs${crypto.createHash('sha256').update(`cita-suite:${appointmentId}`).digest('hex').slice(0, 40)}`;

const googleErrorReason = (body: unknown): string => {
  const row = isRecord(body) ? body : null;
  const error = isRecord(row?.error) ? row.error : null;
  const errors: unknown[] = Array.isArray(error?.errors) ? error.errors : [];
  const first = isRecord(errors[0]) ? errors[0] : null;
  const reason = first?.reason ?? error?.status;
  return typeof reason === 'string' ? reason.trim() : '';
};

const classifyGoogleApiError = (response: Response, body: unknown): GoogleCalendarRemoteError => {
	const reason = googleErrorReason(body);
	if (response.status === 401) {
		return new GoogleCalendarRemoteError('authorization', 'calendar_authorization_expired', 401);
	}
	if (response.status === 404 || response.status === 410) {
		return new GoogleCalendarRemoteError('missing', 'calendar_event_missing', response.status);
	}
	if (response.status === 409) {
		return new GoogleCalendarRemoteError('conflict', 'calendar_event_exists', 409);
	}
	if (
		response.status === 429 ||
		response.status >= 500 ||
		['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError'].includes(reason)
	) {
		return new GoogleCalendarRemoteError('transient', 'calendar_service_busy', response.status);
	}
	if (response.status === 403) {
		return new GoogleCalendarRemoteError('permanent', 'calendar_permission_rejected', 403);
	}
	return new GoogleCalendarRemoteError('permanent', 'calendar_request_rejected', response.status);
};

const googleCalendarRequest = async (
	path: string,
	accessToken: string,
	fetchFn: typeof fetch,
	options: { method?: string; body?: unknown } = {}
): Promise<unknown> => {
	const timer = timeoutSignal(GOOGLE_REQUEST_TIMEOUT_MS);
	try {
		const response = await fetchFn(`${GOOGLE_CALENDAR_API}${path}`, {
			method: options.method ?? 'GET',
			headers: {
				authorization: `Bearer ${accessToken}`,
				...(options.body ? { 'content-type': 'application/json' } : {})
			},
			body: options.body ? JSON.stringify(options.body) : undefined,
			signal: timer.signal
		});
		const body = response.status === 204 ? null : await safeJson(response);
		if (!response.ok) throw classifyGoogleApiError(response, body);
		return body;
	} catch (error) {
		if (error instanceof GoogleCalendarRemoteError) throw error;
		throw new GoogleCalendarRemoteError('transient', 'calendar_network');
	} finally {
		timer.clear();
	}
};

const refreshGoogleAccessToken = async (
	connection: ConnectionRow,
	fetchFn: typeof fetch
): Promise<string> => {
	const config = requireGoogleCalendarConfig();
	if (!connection.refresh_token_ciphertext || connection.revoked_at) {
		throw new GoogleCalendarRemoteError('authorization', 'oauth_reconnect_required');
	}
	let refreshToken: string;
	try {
		refreshToken = decryptGoogleCalendarSecret(
			connection.refresh_token_ciphertext,
			config.encryptionKey
		);
	} catch {
		throw new GoogleCalendarRemoteError('authorization', 'oauth_token_unreadable');
	}
	const token = await postGoogleToken(
		new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			refresh_token: refreshToken,
			grant_type: 'refresh_token'
		}),
		fetchFn
	);
	if (!token.access_token) {
		throw new GoogleCalendarRemoteError('authorization', 'oauth_reconnect_required');
	}
	return token.access_token;
};

const loadEventLink = async (
	supabase: CitaSupabaseClient,
	eventRowId: string
): Promise<{ event: EventLinkRow; connection: ConnectionRow; appointment: PublicAppointmentView }> => {
	const { data: event, error: eventError } = await supabase
		.from('appointment_google_calendar_events')
		.select(
			'id, business_id, appointment_id, connection_id, calendar_id, event_id, sync_status, synced_sequence, attempt_count, claimed_at'
		)
		.eq('id', eventRowId)
		.maybeSingle();
	if (eventError) throw eventError;
	if (!event) throw new Error('GOOGLE_CALENDAR_EVENT_LINK_NOT_FOUND');

	const [{ data: connection, error: connectionError }, { data: appointmentRow, error: appointmentError }] =
		await Promise.all([
			supabase
				.from('google_calendar_connections')
				.select('id, refresh_token_ciphertext, revoked_at')
				.eq('id', event.connection_id)
				.maybeSingle(),
			supabase
				.from('appointments')
				.select('confirmation_token')
				.eq('id', event.appointment_id)
				.eq('business_id', event.business_id)
				.maybeSingle()
		]);
	if (connectionError) throw connectionError;
	if (appointmentError) throw appointmentError;
	if (!connection || !appointmentRow?.confirmation_token) {
		throw new Error('GOOGLE_CALENDAR_SYNC_CONTEXT_NOT_FOUND');
	}
	const appointment = await loadPublicAppointmentByToken(
		supabase,
		String(appointmentRow.confirmation_token)
	);
	if (!appointment) throw new Error('GOOGLE_CALENDAR_APPOINTMENT_NOT_FOUND');
	return {
		event: {
			...event,
			id: String(event.id),
			business_id: String(event.business_id),
			appointment_id: String(event.appointment_id),
			connection_id: String(event.connection_id),
			calendar_id: String(event.calendar_id),
			event_id: event.event_id ? String(event.event_id) : null,
			sync_status: readChoice(event.sync_status, GOOGLE_CALENDAR_SYNC_STATUSES, 'googleCalendar.syncStatus'),
			synced_sequence: Number(event.synced_sequence),
			attempt_count: Number(event.attempt_count ?? 0),
			claimed_at: event.claimed_at ? String(event.claimed_at) : null
		},
		connection: {
			id: String(connection.id),
			refresh_token_ciphertext: connection.refresh_token_ciphertext ?? null,
			revoked_at: connection.revoked_at ?? null
		},
		appointment
	};
};

const nextRetryAt = (attemptCount: number, now: Date): Date => {
	const cappedAttempt = Math.max(0, Math.min(attemptCount, 8));
	const minutes = Math.min(360, 2 ** cappedAttempt);
	// Jitter determinista acotado para no volver a concentrar todos los jobs.
	const seconds = (attemptCount * 37) % 60;
	return new Date(now.getTime() + (minutes * 60 + seconds) * 1000);
};

/** How a failed change is recorded: its category, a safe code and the next attempt. */
const syncFailure = (error: unknown, attemptCount: number, now: Date) => {
	const remote =
		error instanceof GoogleCalendarRemoteError
			? error
			: new GoogleCalendarRemoteError('transient', 'calendar_sync_unexpected');
	return {
		remote,
		category: remote.category === 'conflict' ? 'permanent' : remote.category,
		nextAttemptAt: nextRetryAt(attemptCount + 1, now).toISOString()
	};
};

const markSyncFailure = async (
	supabase: CitaSupabaseClient,
	eventRowId: string,
	error: GoogleCalendarRemoteError,
	attemptCount: number,
	now: Date
) => {
	const failure = syncFailure(error, attemptCount, now);
	const { data, error: rpcError } = await supabase.rpc('fail_google_calendar_event_sync', {
		p_event_row_id: eventRowId,
		p_failure_category: failure.category,
		p_error_code: failure.remote.safeCode,
		p_next_attempt_at: failure.nextAttemptAt,
		p_now: now.toISOString()
	});
	if (rpcError) throw rpcError;
	return String(data ?? 'failed');
};

const completeDelete = async (
	supabase: CitaSupabaseClient,
	eventRowId: string,
	now: Date
): Promise<string | null> => {
	const { data, error } = await supabase.rpc('complete_google_calendar_event_delete', {
		p_event_row_id: eventRowId,
		p_now: now.toISOString()
	});
	if (error) throw error;
	return data ? String(data) : null;
};

const revokeGoogleRefreshToken = async (
	connection: ConnectionRow,
	fetchFn: typeof fetch
): Promise<void> => {
	if (!connection.refresh_token_ciphertext) return;
	let token: string;
	try {
		token = decryptGoogleCalendarSecret(
			connection.refresh_token_ciphertext,
			requireGoogleCalendarConfig().encryptionKey
		);
	} catch {
		return;
	}
	const timer = timeoutSignal(GOOGLE_REQUEST_TIMEOUT_MS);
	try {
		const response = await fetchFn(GOOGLE_TOKEN_REVOCATION_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ token }),
			signal: timer.signal
		});
		if (!response.ok) {
			logServerFailure('Google no confirmó la revocación de una autorización sin vínculos', {
				connectionId: connection.id,
				httpStatus: response.status
			});
		}
	} catch {
		// El secreto ya fue eliminado de la base. No se registra ni se reintenta con
		// una copia adicional: el usuario también puede revocarlo desde Google.
		logServerFailure('No se pudo confirmar la revocación de Google Calendar', {
			connectionId: connection.id
		});
	} finally {
		timer.clear();
	}
};

type GoogleCalendarChange =
	| { outcome: 'deleted' }
	| { outcome: 'delete_requested' }
	| { outcome: 'synced'; googleEventId: string; syncedSequence: number };

/**
 * The remote effect of one pending event, shared by the immediate path and the
 * scheduled batch; each records the outcome its own way. Throws a
 * GoogleCalendarRemoteError when Google refuses or does not answer.
 */
const applyGoogleCalendarChange = async (
	event: Pick<EventLinkRow, 'calendar_id' | 'event_id' | 'sync_status'>,
	appointment: CalendarEventAppointment,
	accessToken: () => Promise<string>,
	fetchFn: typeof fetch,
	now: Date
): Promise<GoogleCalendarChange> => {
	if (event.sync_status === 'pending_delete' || appointment.status === 'cancelled') {
		if (event.event_id) {
			try {
				await googleCalendarRequest(
					`/calendars/${encodeURIComponent(event.calendar_id)}/events/${encodeURIComponent(event.event_id)}`,
					await accessToken(),
					fetchFn,
					{ method: 'DELETE' }
				);
			} catch (error) {
				if (!(error instanceof GoogleCalendarRemoteError) || error.category !== 'missing') {
					throw error;
				}
			}
		}
		return { outcome: 'deleted' };
	}

	const token = await accessToken();
	if (!isActiveAppointmentStatus(appointment.status)) return { outcome: 'delete_requested' };

	const resource = googleCalendarEventResource(appointment, now);
	let googleEventId = event.event_id;
	if (event.sync_status === 'pending_create' || !googleEventId) {
		const deterministicId = deterministicGoogleCalendarEventId(appointment.id);
		try {
			const created = await googleCalendarRequest(
				`/calendars/${encodeURIComponent(event.calendar_id)}/events`,
				token,
				fetchFn,
				{ method: 'POST', body: { ...resource, id: deterministicId } }
			);
			if (!isRecord(created) || typeof created.id !== 'string' || !created.id) throw new GoogleCalendarRemoteError('transient', 'calendar_response_invalid');
			googleEventId = created.id;
		} catch (error) {
			if (!(error instanceof GoogleCalendarRemoteError) || error.category !== 'conflict') {
				throw error;
			}
			// La creacion anterior llego a Google pero la respuesta se perdio.
			const existing = await googleCalendarRequest(
				`/calendars/${encodeURIComponent(event.calendar_id)}/events/${encodeURIComponent(deterministicId)}`,
				token,
				fetchFn
			);
			if (!isRecord(existing) || typeof existing.id !== 'string' || !existing.id) throw new GoogleCalendarRemoteError('transient', 'calendar_response_invalid');
			googleEventId = existing.id;
		}
	} else {
		await googleCalendarRequest(
			`/calendars/${encodeURIComponent(event.calendar_id)}/events/${encodeURIComponent(googleEventId)}`,
			token,
			fetchFn,
			{ method: 'PATCH', body: resource }
		);
	}
	return { outcome: 'synced', googleEventId, syncedSequence: appointment.calendar_sequence };
};

export const processGoogleCalendarEvent = async (
	supabase: CitaSupabaseClient,
	eventRowId: string,
	fetchFn: typeof fetch,
	options: { accessToken?: string; now?: Date } = {}
): Promise<{ status: string; errorCode?: string }> => {
	const now = options.now ?? new Date();
	let loaded: Awaited<ReturnType<typeof loadEventLink>>;
	try {
		loaded = await loadEventLink(supabase, eventRowId);
	} catch (error) {
		logServerFailure('Error cargando trabajo Google Calendar', { eventRowId, error });
		throw error;
	}
	const { event, connection, appointment } = loaded;

	if (!isPendingGoogleCalendarStatus(event.sync_status)) {
		return { status: event.sync_status };
	}

	let accessToken = options.accessToken;
	try {
		const change = await applyGoogleCalendarChange(
			event,
			appointment,
			async () => (accessToken ??= await refreshGoogleAccessToken(connection, fetchFn)),
			fetchFn,
			now
		);
		if (change.outcome === 'deleted') {
			const removedConnectionId = await completeDelete(supabase, event.id, now);
			if (removedConnectionId === connection.id) {
				await revokeGoogleRefreshToken(connection, fetchFn);
			}
			return { status: 'deleted' };
		}
		if (change.outcome === 'delete_requested') {
			const { error } = await supabase.rpc('request_google_calendar_event_deletion', {
				p_appointment_id: appointment.id,
				p_now: now.toISOString()
			});
			if (error) throw error;
			return { status: 'pending_delete' };
		}
		const { data, error } = await supabase.rpc('complete_google_calendar_event_sync', {
			p_event_row_id: event.id,
			p_google_event_id: change.googleEventId,
			p_synced_sequence: change.syncedSequence,
			p_now: now.toISOString()
		});
		if (error) throw error;
		return { status: String(data ?? 'active') };
	} catch (error) {
		const remoteError =
			error instanceof GoogleCalendarRemoteError
				? error
				: new GoogleCalendarRemoteError('transient', 'calendar_sync_unexpected');
		try {
			const status = await markSyncFailure(
				supabase,
				event.id,
				remoteError,
				event.attempt_count,
				now
			);
			logServerFailure('Google Calendar no pudo sincronizar el evento', {
				eventRowId: event.id,
				appointmentId: event.appointment_id,
				category: remoteError.category,
				code: remoteError.safeCode,
				httpStatus: remoteError.httpStatus ?? null
			});
			return { status, errorCode: remoteError.safeCode };
		} catch (recordError) {
			logServerFailure('Error registrando fallo Google Calendar', {
				eventRowId: event.id,
				code: remoteError.safeCode,
				error: recordError
			});
			throw recordError;
		}
	}
};

// Sincronización programada ----------------------------------------------------------

/** Events of one chunk are read, changed and recorded together. */
const CALENDAR_CHUNK_SIZE = MAX_CONCURRENT_EXTERNAL_CALLS;
/** Worst case of one event at Google: token refresh, the change and a lookup or a revocation. */
const CALENDAR_EVENT_PROVIDER_CALLS = 3;
/** Each chunk reads its appointments and records its results. */
const CALENDAR_CHUNK_DATABASE_CALLS = 2;
/** The claim itself and the release when the run stops before its queue ends. */
const CALENDAR_FIXED_CALLS = 2;
/** Largest claim the database accepts in one call. */
const CALENDAR_MAX_CLAIM = 100;

const calendarChunkCalls = (size: number) =>
	CALENDAR_CHUNK_DATABASE_CALLS + CALENDAR_EVENT_PROVIDER_CALLS * size;

/** Events whose chunks fit the calls the run has left. */
const calendarClaimLimit = (remainingCalls: number) => {
	let calls = remainingCalls - CALENDAR_FIXED_CALLS;
	let events = 0;
	while (events < CALENDAR_MAX_CLAIM) {
		const size = Math.min(
			CALENDAR_CHUNK_SIZE,
			Math.floor((calls - CALENDAR_CHUNK_DATABASE_CALLS) / CALENDAR_EVENT_PROVIDER_CALLS)
		);
		if (size < 1) break;
		events += size;
		calls -= calendarChunkCalls(size);
	}
	return Math.min(events, CALENDAR_MAX_CLAIM);
};

type ClaimedCalendarEvent = {
	event: Pick<EventLinkRow, 'id' | 'appointment_id' | 'calendar_id' | 'event_id' | 'sync_status' | 'attempt_count'>;
	connection: ConnectionRow;
};

const readClaimedCalendarEvent = (value: unknown): ClaimedCalendarEvent => {
	const item = readRecord(value, 'calendarBatch.claim');
	return {
		event: {
			id: readText(item.event_row_id, 'calendarBatch.claim.event'),
			appointment_id: readText(item.appointment_id, 'calendarBatch.claim.appointment'),
			calendar_id: readText(item.calendar_id, 'calendarBatch.claim.calendar'),
			event_id: readNullableText(item.event_id, 'calendarBatch.claim.googleEvent'),
			sync_status: readChoice(item.sync_status, GOOGLE_CALENDAR_SYNC_STATUSES, 'calendarBatch.claim.status'),
			attempt_count: readFiniteNumber(item.attempt_count, 'calendarBatch.claim.attempts')
		},
		connection: {
			id: readText(item.connection_id, 'calendarBatch.claim.connection'),
			refresh_token_ciphertext: readNullableText(item.refresh_token_ciphertext, 'calendarBatch.claim.token'),
			revoked_at: readNullableText(item.connection_revoked_at, 'calendarBatch.claim.revokedAt')
		}
	};
};

const readCalendarCompletion = (value: unknown) => {
	const record = readRecord(value, 'calendarBatch.completion');
	return {
		released: readFiniteNumber(record.released, 'calendarBatch.completion.released'),
		results: readArray(record.results, 'calendarBatch.completion.results').map((entry) => {
			const result = readRecord(entry, 'calendarBatch.result');
			return {
				eventRowId: readText(result.event_row_id, 'calendarBatch.result.event'),
				status: readText(result.status, 'calendarBatch.result.status'),
				removedConnectionId: readNullableText(result.removed_connection_id, 'calendarBatch.result.removed')
			};
		})
	};
};

const CALENDAR_APPOINTMENT_SELECT =
	'id, confirmation_token, status, starts_at, ends_at, professional_name_snapshot, calendar_sequence, businesses!inner(name, timezone, address, address_instructions, maps_url)';

type CalendarAppointmentRow = Pick<
	CitaRow<'appointments'>,
	'id' | 'confirmation_token' | 'status' | 'starts_at' | 'ends_at' | 'professional_name_snapshot' | 'calendar_sequence'
> & {
	businesses: Pick<CitaRow<'businesses'>, 'name' | 'timezone' | 'address' | 'address_instructions' | 'maps_url'>;
};

/**
 * Appointments of one chunk in one read, revalidated right before the change at
 * Google; a cancellation or a reschedule after the claim is seen here. The place
 * follows the same rule as the public view of the appointment.
 */
const loadCalendarAppointments = async (
	supabase: CitaSupabaseClient,
	appointmentIds: string[]
): Promise<Map<string, CalendarEventAppointment>> => {
	const appointments = new Map<string, CalendarEventAppointment>();
	const add = (row: CalendarAppointmentRow, bookingContext: AppointmentBookingContext | null) => {
		if (!isAppointmentStatus(row.status)) throw new InvalidDataContractError('calendarBatch.appointment.status');
		appointments.set(row.id, {
			id: row.id,
			token: row.confirmation_token,
			status: row.status,
			starts_at: row.starts_at,
			ends_at: row.ends_at,
			professional_name_snapshot: row.professional_name_snapshot,
			calendar_sequence: row.calendar_sequence,
			booking_context: bookingContext,
			business: {
				name: row.businesses.name,
				timezone: row.businesses.timezone,
				...publicAppointmentPlace(row.businesses, bookingContext)
			}
		});
	};
	if (bookingContextsAvailable()) {
		const { data, error } = await supabase
			.from('appointments')
			.select(`${CALENDAR_APPOINTMENT_SELECT},appointment_booking_contexts(theme_snapshot,modality,video_instructions_snapshot)`)
			.in('id', appointmentIds)
			.retry(false);
		if (error) throw error;
		for (const row of data) {
			// PostgREST embeds this optional one-to-one relation as object|null,
			// including null for manual appointments. Generated FK metadata alone
			// does not describe that JSON shape; validate it at the shared boundary.
			const context = row.appointment_booking_contexts;
			add(row, context === null ? null : readAppointmentBookingContext(context));
		}
	} else {
		const { data, error } = await supabase
			.from('appointments')
			.select(CALENDAR_APPOINTMENT_SELECT)
			.in('id', appointmentIds)
			.retry(false);
		if (error) throw error;
		for (const row of data) add(row, null);
	}
	return appointments;
};

type CalendarBatchResult =
	| { event_row_id: string; outcome: 'synced'; google_event_id: string; synced_sequence: number }
	| { event_row_id: string; outcome: 'deleted' | 'delete_requested' }
	| {
			event_row_id: string;
			outcome: 'failed';
			failure_category: string;
			error_code: string;
			next_attempt_at: string;
	  };

/**
 * One scheduled calendar run. The claim shares the queue between practices and
 * carries each connection; an access token is refreshed once per connection and
 * run. Each chunk reads its appointments, makes the changes at Google and records
 * them in one database trip; a chunk starts only while its worst case still fits.
 */
export const processGoogleCalendarSyncBatch = async (job: ScheduledJobRun) => {
	const summary = { configured: isGoogleCalendarConfigured(), claimed: 0, active: 0, deleted: 0, retrying: 0, attention: 0, stale: 0, released: 0 };
	if (!summary.configured) return summary;
	const limit = calendarClaimLimit(job.budget.remaining());
	if (limit < 1) return summary;
	const now = job.now.toISOString();
	const claimToken = crypto.randomUUID();
	const { data: claimed, error: claimError } = await job.supabase.rpc('claim_google_calendar_sync_batch', {
		p_now: now,
		p_limit: limit,
		p_claim_token: claimToken
	});
	if (claimError) throw claimError;
	const queue = readArray(claimed, 'calendarBatch.claim').map(readClaimedCalendarEvent);
	summary.claimed = queue.length;
	if (!queue.length) return summary;
	const accessTokens = new Map<string, Promise<string>>();
	const accessTokenFor = (connection: ConnectionRow) => {
		let token = accessTokens.get(connection.id);
		if (!token) {
			token = refreshGoogleAccessToken(connection, job.providerFetch);
			accessTokens.set(connection.id, token);
		}
		return token;
	};
	let finished = false;
	try {
		while (queue.length && job.budget.admits({ calls: calendarChunkCalls(Math.min(CALENDAR_CHUNK_SIZE, queue.length)) }, 1)) {
			const chunk = queue.splice(0, CALENDAR_CHUNK_SIZE);
			const appointments = await loadCalendarAppointments(job.supabase, chunk.map((item) => item.event.appointment_id));
			const results = await Promise.all(
				chunk.map(async ({ event, connection }): Promise<CalendarBatchResult> => {
					try {
						const appointment = appointments.get(event.appointment_id);
						if (!appointment) throw new GoogleCalendarRemoteError('transient', 'calendar_appointment_unavailable');
						const change = await applyGoogleCalendarChange(event, appointment, () => accessTokenFor(connection), job.providerFetch, job.now);
						return change.outcome === 'synced'
							? { event_row_id: event.id, outcome: 'synced', google_event_id: change.googleEventId, synced_sequence: change.syncedSequence }
							: { event_row_id: event.id, outcome: change.outcome };
					} catch (error) {
						const failure = syncFailure(error, event.attempt_count, job.now);
						return {
							event_row_id: event.id,
							outcome: 'failed',
							failure_category: failure.category,
							error_code: failure.remote.safeCode,
							next_attempt_at: failure.nextAttemptAt
						};
					}
				})
			);
			finished = queue.length === 0;
			const { data, error } = await job.supabase.rpc('complete_google_calendar_sync_batch', {
				p_claim_token: claimToken,
				p_now: now,
				p_results: results,
				p_finish: finished
			});
			if (error) throw error;
			const completion = readCalendarCompletion(data);
			summary.released += completion.released;
			for (const result of completion.results) {
				if (result.status === 'active') summary.active += 1;
				else if (result.status === 'deleted') summary.deleted += 1;
				else if (result.status === 'stale') summary.stale += 1;
				else if (result.status.startsWith('pending_')) summary.retrying += 1;
				else summary.attention += 1;
				// Revoked only after the deletion that removed its last link is committed.
				const connection = chunk.find((item) => item.connection.id === result.removedConnectionId)?.connection;
				if (connection) await revokeGoogleRefreshToken(connection, job.providerFetch);
			}
		}
		if (!finished) {
			job.budget.enterFinalization();
			const { data, error } = await job.supabase.rpc('complete_google_calendar_sync_batch', {
				p_claim_token: claimToken,
				p_now: now,
				p_results: [],
				p_finish: true
			});
			if (error) throw error;
			summary.released += readCalendarCompletion(data).released;
		}
		return summary;
	} catch (error) {
		// Abandoned claims expire on their own; releasing them now only saves the wait.
		try {
			job.budget.enterFinalization();
			const { error: releaseError } = await job.supabase.rpc('complete_google_calendar_sync_batch', {
				p_claim_token: claimToken,
				p_now: now,
				p_results: [],
				p_finish: true
			});
			if (releaseError) throw releaseError;
		} catch (releaseError) {
			logServerFailure('Error cerrando el lote de Google Calendar', releaseError);
		}
		throw error;
	}
};

export const processAppointmentGoogleCalendarSync = async (
	supabase: CitaSupabaseClient,
	appointmentId: string,
	fetchFn: typeof fetch,
	options: { now?: Date } = {}
) => {
	if (!isGoogleCalendarConfigured()) return { status: 'not_configured' };
	const { data, error } = await supabase
		.from('appointment_google_calendar_events')
		.select('id, sync_status, claimed_at')
		.eq('appointment_id', appointmentId)
		.maybeSingle();
	if (error) throw error;
	if (!data || !isPendingGoogleCalendarStatus(String(data.sync_status))) {
		return { status: data?.sync_status ? String(data.sync_status) : 'not_connected' };
	}
	const claimedAt = data.claimed_at ? new Date(String(data.claimed_at)).getTime() : Number.NaN;
	const now = options.now ?? new Date();
	if (Number.isFinite(claimedAt) && claimedAt > now.getTime() - 10 * 60 * 1000) {
		return { status: String(data.sync_status) };
	}
	return processGoogleCalendarEvent(supabase, String(data.id), fetchFn, { ...options, now });
};

export const loadGoogleCalendarUiState = async (
	supabase: CitaSupabaseClient,
	appointment: PublicAppointmentView,
	now = new Date()
): Promise<GoogleCalendarUiState> => {
	const available = isGoogleCalendarConfigured();
	const reminderLabel = googleCalendarReminderLabel(new Date(appointment.starts_at), now);
	if (!available) {
		return { available: false, state: 'none', current: false, reminderLabel };
	}
	const { data, error } = await supabase
		.from('appointment_google_calendar_events')
		.select('sync_status, synced_sequence')
		.eq('appointment_id', appointment.id)
		.maybeSingle();
	if (error) throw error;
	if (!data || String(data.sync_status) === 'detached') {
		return { available, state: 'none', current: false, reminderLabel };
	}
	const status = readChoice(data.sync_status, ['pending_create', 'pending_update', 'pending_delete', 'active', 'deleted', 'detached', 'needs_reconnect', 'failed'], 'googleCalendar.syncStatus');
	if (status === 'deleted') {
		return { available, state: 'removed', current: false, reminderLabel };
	}
	const current = status === 'active' && Number(data.synced_sequence) === appointment.calendar_sequence;
	if (current) return { available, state: 'active', current: true, reminderLabel };
	if (status === 'pending_create') return { available, state: 'preparing', current: false, reminderLabel };
	if (status === 'pending_update') return { available, state: 'updating', current: false, reminderLabel };
	if (status === 'pending_delete') return { available, state: 'removing', current: false, reminderLabel };
	if (status === 'needs_reconnect') {
		return { available, state: 'needs_reconnect', current: false, reminderLabel };
	}
	return { available, state: 'failed', current: false, reminderLabel };
};

export const requestGoogleCalendarEventDeletion = async (
	supabase: CitaSupabaseClient,
	appointmentId: string,
	fetchFn: typeof fetch
) => {
	// El código administrado se conserva, pero el interruptor debe bloquear también
	// acciones residuales enviadas a mano o desde una pestaña antigua. No mutar la
	// cola mientras la función está deshabilitada.
	if (!isGoogleCalendarConfigured()) return { status: 'not_configured' };
	const now = new Date();
	const { data, error } = await supabase.rpc('request_google_calendar_event_deletion', {
		p_appointment_id: appointmentId,
		p_now: now.toISOString()
	});
	if (error) throw error;
	if (!data) throw new Error('GOOGLE_CALENDAR_EVENT_LINK_NOT_FOUND');
	return processAppointmentGoogleCalendarSync(supabase, appointmentId, fetchFn, { now });
};

export const getGoogleCalendarPublicMessage = (code: string | null): string | null => {
	if (code === 'connected') return 'Listo, el turno quedó guardado en tu cuenta Google con avisos.';
	if (code === 'preparing') return 'Estamos terminando de guardar el turno con sus avisos.';
	if (code === 'removed') return 'El turno se quitó de tu cuenta Google.';
	if (code === 'cancelled') return 'No se hicieron cambios en tu calendario.';
	if (code === 'reconnect') return 'Volvé a elegir tu cuenta Google para actualizar los avisos.';
	if (code === 'unavailable') return 'Esta cuenta no pudo guardar el turno. Podés elegir otra forma de calendario.';
	return null;
};

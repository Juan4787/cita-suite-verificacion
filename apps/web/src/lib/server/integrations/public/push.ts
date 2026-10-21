import { isUuid } from '@cita-suite/shared/uuid';
import { logServerFailure } from '$lib/server/platform/logging';
import {
	readArray,
	readChoice,
	readFiniteNumber,
	readNullableText,
	readRecord,
	readText,
	isRecord
} from '$lib/contracts/json';
import { InvalidDataContractError } from '$lib/contracts/json';
// Recordatorios Web Push para navegadores compatibles (este flujo nunca se ofrece en iOS).
//
// Confiabilidad del envío: la reclamación por lotes (claim_push_reminder_batch) reparte
// la cola entre consultorios y vence a los 10 minutos si el proceso muere. La base
// revalida cada recordatorio justo antes del envío y sent_at se marca SOLO con la
// aceptación del proveedor; un fallo espera en forma persistente y creciente.

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import webpush from 'web-push';
import crypto from 'node:crypto';
import { isIP } from 'node:net';
import type { CitaRow, CitaSupabaseClient } from '$lib/types/database';
import { writeAuditLog } from '$lib/server/platform/audit';
import { formatInTimeZone } from '$lib/utils/format';
import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';
import type { PublicAppointmentView } from '$lib/server/scheduling/public/public-appointments';
import {
	JobBudgetExhaustedError,
	MAX_CONCURRENT_EXTERNAL_CALLS,
	type ScheduledJobRun
} from '$lib/server/integrations/internal/job-budget';

const TEST_PUSH_TTL_SECONDS = 5 * 60;
/** Upper bound of one push request outside a job; a job budget may cut it shorter. */
const PUSH_REQUEST_TIMEOUT_MS = 10_000;
const pushAppointmentPath = (confirmationToken: string) =>
	`/turno/${encodeURIComponent(confirmationToken)}`;

export type PushDeliveryKind = 'test' | '24h' | '2h' | 'reschedule' | 'review';
export type PushDeliveryState =
	| 'pending'
	| 'accepted'
	| 'received'
	| 'displayed'
	| 'clicked'
	| 'confirmed'
	| 'missing'
	| 'superseded'
	| 'failed'
	| 'expired';

export type PushDeliveryStatus = {
	deliveryId: string;
	state: PushDeliveryState;
	kind: PushDeliveryKind;
	createdAt: string;
	expiresAt: string;
};

export const getVapidPublicKey = (): string | null =>
	publicEnv.PUBLIC_VAPID_PUBLIC_KEY?.trim() || env.VAPID_PUBLIC_KEY?.trim() || null;

export const isPushConfigured = (): boolean =>
	Boolean(getVapidPublicKey() && env.VAPID_PRIVATE_KEY?.trim());

const readVapidKeys = () => {
	const publicKey = getVapidPublicKey();
	const privateKey = env.VAPID_PRIVATE_KEY?.trim();
	if (!publicKey || !privateKey) throw new Error('PUSH_NOT_CONFIGURED');
	return { subject: env.VAPID_SUBJECT?.trim() || 'mailto:soporte@example.com', publicKey, privateKey };
};

export type WebPushTarget = { endpoint: string; p256dh: string; auth: string };
export type WebPushSender = (
	target: WebPushTarget,
	payload: string,
	options: { ttlSeconds: number; topic: string }
) => Promise<number>;

/** Answer of a push service outside 2xx; `code` names a delivery recovered without a send. */
export class PushServiceError extends Error {
	constructor(
		readonly statusCode: number,
		readonly code: string | null = null
	) {
		super(`Push service answered HTTP ${statusCode}.`);
		this.name = 'PushServiceError';
	}
}

// web-push only encrypts the payload: the request goes out through the caller's fetch,
// so a scheduled job counts and bounds it and no Node HTTP client is involved. The
// VAPID signature is made once per push service origin, not once per message.
export const createWebPushSender = (fetchFn: typeof fetch): WebPushSender => {
	const keys = readVapidKeys();
	const authorizations = new Map<string, string>();
	return async (target, payload, options) => {
		const audience = new URL(target.endpoint).origin;
		let authorization = authorizations.get(audience);
		if (!authorization) {
			authorization = webpush.getVapidHeaders(audience, keys.subject, keys.publicKey, keys.privateKey, 'aes128gcm')
				.Authorization;
			authorizations.set(audience, authorization);
		}
		const request = webpush.generateRequestDetails(
			{ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
			payload,
			{
				TTL: options.ttlSeconds,
				urgency: 'high',
				topic: options.topic,
				contentEncoding: 'aes128gcm',
				headers: { Authorization: authorization }
			}
		);
		const headers = new Headers();
		// fetch sets the length of the body itself.
		for (const [name, value] of Object.entries(request.headers))
			if (name.toLowerCase() !== 'content-length') headers.set(name, String(value));
		const response = await fetchFn(request.endpoint, {
			method: 'POST',
			headers,
			body: new Uint8Array(request.body),
			signal: AbortSignal.timeout(PUSH_REQUEST_TIMEOUT_MS)
		});
		// The short answer is not used; releasing it frees the outgoing connection.
		await response.body?.cancel();
		if (!response.ok) throw new PushServiceError(response.status);
		return response.status;
	};
};

export type PushSubscriptionPayload = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
};

// El endpoint llega desde un navegador público y luego se usa como destino de un
// request server-side firmado por VAPID. No alcanza con exigir HTTPS: un host
// arbitrario permitiría usar la activación de recordatorios como proxy hacia
// servicios ajenos (incluidos destinos internos resueltos por DNS). Estos son los
// dominios publicados por los servicios Web Push soportados por la aplicación.
const isKnownPushServiceHost = (hostname: string) =>
	hostname === 'fcm.googleapis.com' ||
	hostname === 'updates.push.services.mozilla.com' ||
	hostname === 'push.services.mozilla.com' ||
	hostname === 'web.push.apple.com' ||
	hostname.endsWith('.notify.windows.com') ||
	hostname.endsWith('.wns.windows.com');

export const isValidPushDeliveryId = (value: string) => isUuid(value);

export const isValidPushTestRequestKey = (value: string) =>
	/^[A-Za-z0-9:_-]{16,180}$/.test(value);

export const isValidSubscriptionPayload = (raw: unknown): raw is PushSubscriptionPayload => {
	const candidate = isRecord(raw) ? raw : null;
	if (
		!candidate ||
		typeof candidate.endpoint !== 'string' ||
		candidate.endpoint.length > 2048 ||
		!isRecord(candidate.keys) ||
		typeof candidate.keys.p256dh !== 'string' ||
		candidate.keys.p256dh.length === 0 ||
		candidate.keys.p256dh.length > 512 ||
		typeof candidate.keys.auth !== 'string' ||
		candidate.keys.auth.length === 0 ||
		candidate.keys.auth.length > 512
	) {
		return false;
	}
	try {
		const endpoint = new URL(candidate.endpoint);
		const hostname = endpoint.hostname.replace(/^\[|\]$/g, '').toLowerCase();
		const p256dh = Buffer.from(candidate.keys.p256dh, 'base64url');
		const auth = Buffer.from(candidate.keys.auth, 'base64url');
		return (
			endpoint.protocol === 'https:' &&
			Boolean(hostname) &&
			isKnownPushServiceHost(hostname) &&
			!endpoint.username &&
			!endpoint.password &&
			(!endpoint.port || endpoint.port === '443') &&
			isIP(hostname) === 0 &&
			hostname !== 'localhost' &&
			!hostname.endsWith('.localhost') &&
			!hostname.endsWith('.local') &&
			!hostname.endsWith('.internal') &&
			!hostname.endsWith('.home.arpa') &&
			/^[A-Za-z0-9_-]+$/.test(candidate.keys.p256dh) &&
			/^[A-Za-z0-9_-]+$/.test(candidate.keys.auth) &&
			p256dh.length === 65 &&
			p256dh[0] === 4 &&
			auth.length === 16
		);
	} catch {
		return false;
	}
};

// El endpoint y su verificación pertenecen al dispositivo. La RPC crea por
// separado el vínculo con el turno y aplica el bloqueo absoluto de 48 horas tras
// "Sí, la recibí". El paso del tiempo, por sí solo, nunca exige otra prueba.
export const saveAppointmentPushSubscription = async (
	supabase: CitaSupabaseClient,
	appointment: PublicAppointmentView,
	payload: PushSubscriptionPayload,
	userAgent: string | null
) => {
	const { data, error } = await supabase
		.rpc('save_appointment_push_subscription', {
			target_business_id: appointment.business.id,
			target_appointment_id: appointment.id,
			target_endpoint: payload.endpoint,
			target_p256dh: payload.keys.p256dh,
			target_auth: payload.keys.auth,
			target_user_agent: userAgent,
			save_time: new Date().toISOString()
		})
		.single();
	if (error) throw error;
	const saved = data;
	if (!saved?.subscription_id) throw new Error('PUSH_SUBSCRIPTION_NOT_SAVED');

	await writeAuditLog(supabase, {
		businessId: appointment.business.id,
		userId: null,
		action: 'appointment.push_subscribed',
		entityType: 'appointment',
		entityId: appointment.id,
		metadata: { endpoint_host: new URL(payload.endpoint).hostname }
	});

	return {
		id: String(saved.subscription_id),
		endpoint: String(saved.endpoint),
		verifiedAt: saved.verification_confirmed_at
			? String(saved.verification_confirmed_at)
			: null,
		providerGone: saved.provider_gone === true
	};
};

const hashReceiptToken = (token: string) =>
	crypto.createHash('sha256').update(token).digest('hex');

const receiptTokenMatches = (token: string, expectedHash: string) => {
	if (!token || token.length > 256 || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
	const actual = Buffer.from(hashReceiptToken(token), 'hex');
	const expected = Buffer.from(expectedHash, 'hex');
	return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

type DeliveryRow = Pick<CitaRow<'push_delivery_attempts'>, 'id' | 'kind' | 'user_confirmed_at' | 'clicked_at' | 'user_reported_missing_at' | 'superseded_at' | 'failed_at' | 'displayed_at' | 'expires_at' | 'received_at' | 'accepted_at' | 'created_at'>;

const deliveryState = (row: DeliveryRow, now: Date): PushDeliveryState => {
	if (row.user_confirmed_at) return 'confirmed';
	if (row.clicked_at) return 'clicked';
	if (row.user_reported_missing_at) return 'missing';
	if (row.superseded_at) return 'superseded';
	if (row.failed_at) return 'failed';
	if (row.displayed_at) return 'displayed';
	if (new Date(row.expires_at) <= now) return 'expired';
	if (row.received_at) return 'received';
	if (row.accepted_at) return 'accepted';
	return 'pending';
};

const toDeliveryStatus = (row: DeliveryRow, now = new Date()): PushDeliveryStatus => {
  const kind = (['test', '24h', '2h', 'reschedule', 'review'] as const).find(kind => kind === row.kind);
  if (!kind) throw new InvalidDataContractError('pushDelivery.kind');
  return ({
	deliveryId: String(row.id),
	state: deliveryState(row, now),
	kind,
	createdAt: String(row.created_at),
	expiresAt: String(row.expires_at)
});
};

export const getPushDeliveryStatus = async (
	supabase: CitaSupabaseClient,
	input: { appointmentId: string; deliveryId: string; now?: Date }
): Promise<PushDeliveryStatus | null> => {
	const { data, error } = await supabase
		.from('push_delivery_attempts')
		.select(
			'id, kind, accepted_at, received_at, displayed_at, clicked_at, user_confirmed_at, user_reported_missing_at, superseded_at, failed_at, expires_at, created_at'
		)
		.eq('id', input.deliveryId)
		.eq('appointment_id', input.appointmentId)
		.maybeSingle();
	if (error) throw error;
	return data ? toDeliveryStatus(data, input.now ?? new Date()) : null;
};

export const getLatestPushTestStatus = async (
	supabase: CitaSupabaseClient,
	input: { subscriptionId: string; now?: Date }
): Promise<PushDeliveryStatus | null> => {
	const { data, error } = await supabase
		.from('push_delivery_attempts')
		.select(
			'id, kind, accepted_at, received_at, displayed_at, clicked_at, user_confirmed_at, user_reported_missing_at, superseded_at, failed_at, expires_at, created_at'
		)
		.eq('subscription_id', input.subscriptionId)
		.eq('kind', 'test')
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return data ? toDeliveryStatus(data, input.now ?? new Date()) : null;
};

export const recordPushDeliveryReceipt = async (
	supabase: CitaSupabaseClient,
	input: {
		appointmentId: string;
		deliveryId: string;
		receiptToken: string;
		stage: 'received' | 'displayed' | 'clicked';
		now?: Date;
	}
): Promise<boolean> => {
	if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.receiptToken)) return false;
	if (input.stage === 'clicked') {
		// El RPC registra la interacción y verifica la suscripción en una sola
		// transacción. Así el turno nunca queda a medias entre telemetría y cobertura.
		const { data, error } = await supabase.rpc('record_push_notification_click', {
			target_appointment_id: input.appointmentId,
			target_delivery_id: input.deliveryId,
			target_receipt_token_hash: hashReceiptToken(input.receiptToken),
			click_time: (input.now ?? new Date()).toISOString()
		});
		if (error) throw error;
		return data === true;
	}

	const { data, error } = await supabase
		.from('push_delivery_attempts')
		.select('id, receipt_token_hash, received_at, displayed_at')
		.eq('id', input.deliveryId)
		.eq('appointment_id', input.appointmentId)
		.maybeSingle();
	if (error) throw error;
	if (!data || !receiptTokenMatches(input.receiptToken, String(data.receipt_token_hash))) {
		return false;
	}

	if (input.stage === 'received' && data.received_at) return true;
	if (input.stage === 'displayed' && data.displayed_at) return true;

	const now = (input.now ?? new Date()).toISOString();
	const updates =
		input.stage === 'received'
			? { received_at: now, updated_at: now }
			: { received_at: data.received_at ?? now, displayed_at: now, updated_at: now };
	const { data: updated, error: updateError } = await supabase
		.from('push_delivery_attempts')
		.update(updates)
		.eq('id', input.deliveryId)
		.eq('appointment_id', input.appointmentId)
		.select('id')
		.maybeSingle();
	if (updateError) throw updateError;
	return Boolean(updated?.id);
};

export const recordPushTestFeedback = async (
	supabase: CitaSupabaseClient,
	input: { appointmentId: string; deliveryId: string; visible: boolean; now?: Date }
): Promise<boolean> => {
	// La persona puede confirmar aunque Android omita el recibo "displayed". El RPC
	// exige una prueba aceptada y serializa la respuesta con un posible clic del
	// service worker para que una interacción real nunca se pierda por una carrera.
	const { data, error } = await supabase.rpc('record_push_test_feedback', {
		target_appointment_id: input.appointmentId,
		target_delivery_id: input.deliveryId,
		feedback_visible: input.visible,
		feedback_time: (input.now ?? new Date()).toISOString()
	});
	if (error) throw error;
	return data === true;
};

export type TrackedPushTarget = {
	id: string;
	endpoint: string;
	p256dh: string;
	auth: string;
};

// RFC 8030 limita Topic a 32 caracteres URL-safe. Los avisos reales del mismo
// turno comparten topic: si el dispositivo estuvo sin conexión, el proveedor
// reemplaza el horario anterior por el último en vez de entregarlos fuera de orden.
export const pushTopicForAppointment = (
	appointmentId: string,
	scope: 'reminder' | 'test' | 'review' = 'reminder'
) =>
	crypto
		.createHash('sha256')
		.update(`${scope}:${appointmentId}`)
		.digest('base64url')
		.slice(0, 32);

type TrackedPushResult =
	| {
			ok: true;
			deliveryId: string | null;
			pushServiceStatus: number | null;
			reused?: boolean;
	  }
	| { ok: false; deliveryId: string | null; error: unknown };

/** 404/410 retire the device; 429, 5xx and lost answers are retried; other 4xx are rejections. */
export const failureKindFor = (error: unknown): 'gone' | 'rejected' | 'transient' => {
	const statusCode = error instanceof PushServiceError ? error.statusCode : 0;
	if (statusCode === 404 || statusCode === 410) return 'gone';
	if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) return 'rejected';
	return 'transient';
};

// A repair or detachment won the race: sending without a durable attempt could notify
// a patient about an appointment that is no longer theirs.
const IDENTITY_RACE_CODES = [
	'PUSH_SUBSCRIPTION_DETACHED',
	'PUSH_DEVICE_GONE',
	'PUSH_SUBSCRIPTION_REVOKED',
	'PUSH_SUBSCRIPTION_MISMATCH',
	'PUSH_SUBSCRIPTION_NOT_FOUND'
];

export const sendTrackedPush = async (
	supabase: CitaSupabaseClient,
	send: WebPushSender,
	input: {
		businessId: string;
		appointmentId: string;
		confirmationToken: string;
		target: TrackedPushTarget;
		kind: PushDeliveryKind;
		payload: Record<string, unknown>;
		ttlSeconds: number;
		topic: string;
		now: Date;
		requestKeyHash?: string | null;
		googleReviewRequestId?: string | null;
		requireTracking?: boolean;
	}
): Promise<TrackedPushResult> => {
	const receiptToken = crypto.randomBytes(32).toString('base64url');
	const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000).toISOString();
	let deliveryId: string | null = null;

	// La telemetría no debe impedir los avisos inmediatos. La prueba visible, en
	// cambio, exige una fila durable: sin ella no podríamos garantizar que dos
	// eventos de foco representen una sola entrega lógica.
	const { data: tracked, error: trackingError } = await supabase
		.from('push_delivery_attempts')
		.insert({
			business_id: input.businessId,
			appointment_id: input.appointmentId,
			subscription_id: input.target.id,
			kind: input.kind,
			request_key_hash: input.requestKeyHash ?? null,
			google_review_request_id: input.googleReviewRequestId ?? null,
			receipt_token_hash: hashReceiptToken(receiptToken),
			expires_at: expiresAt,
			created_at: input.now.toISOString(),
			updated_at: input.now.toISOString()
		})
		.select('id')
		.single();
	if (!trackingError) deliveryId = String(tracked.id);
	else {
		const errorText = `${trackingError.code} ${trackingError.message} ${trackingError.details}`;
		if (IDENTITY_RACE_CODES.some((code) => errorText.includes(code))) {
			return { ok: false, deliveryId: null, error: trackingError };
		}
		if (input.googleReviewRequestId && trackingError.code === '23505') {
			try {
				const { data: existing, error: existingError } = await supabase
					.from('push_delivery_attempts')
					.select(
						'id, accepted_at, received_at, displayed_at, clicked_at, push_service_status, failed_at'
					)
					.eq('google_review_request_id', input.googleReviewRequestId)
					.eq('kind', 'review')
					.is('failed_at', null)
					.order('created_at', { ascending: false })
					.limit(1)
					.maybeSingle()
					.retry(false);
				if (existingError) throw existingError;
				if (
					existing?.id &&
					(existing.accepted_at ||
						existing.received_at ||
						existing.displayed_at ||
						existing.clicked_at)
				) {
					return {
						ok: true,
						deliveryId: String(existing.id),
						pushServiceStatus: Number(existing.push_service_status ?? 0) || null,
						reused: true
					};
				}
			} catch (lookupError) {
				logServerFailure('Error reconciliando entrega de reseña', lookupError);
			}
			return {
				ok: false,
				deliveryId: null,
				error: new PushServiceError(503, 'PUSH_REVIEW_DELIVERY_OUTCOME_UNKNOWN')
			};
		}
		if (input.requestKeyHash && trackingError.code === '23505') {
			try {
				const { data: existing, error: existingError } = await supabase
					.from('push_delivery_attempts')
					.select('id, push_service_status, failed_at, failure_kind')
					.eq('subscription_id', input.target.id)
					.eq('request_key_hash', input.requestKeyHash)
					.eq('kind', input.kind)
					.maybeSingle()
					.retry(false);
				if (existingError) throw existingError;
				if (existing?.id) {
					if (existing.failed_at) {
						return {
							ok: false,
							deliveryId: String(existing.id),
							error: new PushServiceError(
								existing.failure_kind === 'gone' ? 410 : 503,
								`PUSH_TEST_${String(existing.failure_kind ?? 'FAILED').toUpperCase()}`
							)
						};
					}
					return {
						ok: true,
						deliveryId: String(existing.id),
						pushServiceStatus:
							Number(existing.push_service_status ?? 0) || null,
						reused: true
					};
				}
			} catch (lookupError) {
				logServerFailure('Error recuperando prueba push idempotente', lookupError);
			}
		}
		logServerFailure('Error creando seguimiento de push', trackingError);
		if (input.requireTracking) {
			return { ok: false, deliveryId: null, error: trackingError };
		}
	}

	const delivery = deliveryId
		? {
				id: deliveryId,
				token: receiptToken,
				// Relativo para que el acuse vuelva siempre al mismo origen que ejecutó el
				// service worker, aun si PUBLIC_SITE_URL quedó desactualizado.
				receiptUrl: `${pushAppointmentPath(input.confirmationToken)}/push/receipt`
			}
		: undefined;

	try {
		const pushServiceStatus = await send(
			input.target,
			JSON.stringify({ ...input.payload, ...(delivery ? { delivery } : {}) }),
			{ ttlSeconds: input.ttlSeconds, topic: input.topic }
		);
		if (deliveryId) {
			const acceptedAt = new Date().toISOString();
			const { error } = await supabase
				.from('push_delivery_attempts')
				.update({
					accepted_at: acceptedAt,
					push_service_status: pushServiceStatus,
					updated_at: acceptedAt
				})
				.eq('id', deliveryId);
			if (error) logServerFailure('Error registrando aceptación del push', error);
		}
		return { ok: true, deliveryId, pushServiceStatus };
	} catch (error) {
		if (deliveryId) {
			const failedAt = new Date().toISOString();
			const statusCode = error instanceof PushServiceError ? error.statusCode : null;
			const { error: trackingError } = await supabase
				.from('push_delivery_attempts')
				.update({
					failed_at: failedAt,
					failure_kind: failureKindFor(error),
					push_service_status: statusCode,
					updated_at: failedAt
				})
				.eq('id', deliveryId);
			if (trackingError) logServerFailure('Error registrando fallo del push', trackingError);
		}
		return { ok: false, deliveryId, error };
	}
};

export const pushTtlUntilAppointment = (
	startsAt: Date,
	now: Date,
	maximumSeconds: number
) => Math.max(0, Math.min(maximumSeconds, Math.floor((startsAt.getTime() - now.getTime()) / 1000)));

export const sendTestPushNotification = async (
	supabase: CitaSupabaseClient,
	fetchFn: typeof fetch,
	input: {
		appointment: PublicAppointmentView;
		subscription: TrackedPushTarget;
		requestKey?: string;
		now?: Date;
	}
) => {
	if (!isPushConfigured()) return { configured: false, accepted: false, deliveryId: null };
	const now = input.now ?? new Date();
	try {
		const latest = await getLatestPushTestStatus(supabase, {
			subscriptionId: input.subscription.id,
			now
		});
		if (
			latest &&
			now.getTime() - new Date(latest.createdAt).getTime() < 30_000 &&
			['pending', 'accepted', 'received', 'displayed', 'clicked', 'confirmed'].includes(
				latest.state
			)
		) {
			// Una segunda pestaña puede traer otra clave lógica, pero si apunta a la
			// misma suscripción y ya hay una prueba viva, debe observar esa entrega en
			// vez de generar otra. Los estados missing/failed/expired sí habilitan retry.
			return { configured: true, accepted: true, deliveryId: latest.deliveryId, gone: false };
		}
	} catch (trackingError) {
		// Una falla de observabilidad no bloquea la prueba ni los recordatorios reales.
		logServerFailure('Error consultando prueba push reciente', trackingError);
	}
	const result = await sendTrackedPush(supabase, createWebPushSender(fetchFn), {
		businessId: input.appointment.business.id,
		appointmentId: input.appointment.id,
		confirmationToken: input.appointment.token,
		target: input.subscription,
		kind: 'test',
		payload: {
			title: 'Notificaciones activadas',
			body: `Esta es una prueba de ${input.appointment.business.name}.`,
			url: pushAppointmentPath(input.appointment.token),
			tag: `turno-${input.appointment.id}-test-${now.getTime()}`,
			group: `turno-${input.appointment.id}`
		},
		ttlSeconds: TEST_PUSH_TTL_SECONDS,
		topic: pushTopicForAppointment(input.appointment.id, 'test'),
		now,
		requestKeyHash: input.requestKey
			? crypto.createHash('sha256').update(input.requestKey).digest('hex')
			: null,
		requireTracking: Boolean(input.requestKey)
	});
	if (!result.ok && isGoneError(result.error)) {
		await markEndpointGone(supabase, input.subscription.endpoint, now);
	}
	return {
		configured: true,
		accepted: result.ok,
		deliveryId: result.deliveryId,
		gone: !result.ok && isGoneError(result.error)
	};
};

// Reprogramación: invalida los avisos pendientes del horario VIEJO y deja que se
// recalculen los de 24h/2h para el NUEVO horario. Limpiar *_sent_at desbloquea el
// reenvío, limpiar la reclamación (*_claimed_at y su token) descarta el resultado
// tardío de un envío en vuelo y limpiar la espera reinicia los reintentos: el horario
// nuevo empieza sin el historial del viejo. Las ventanas se computan contra el
// starts_at vivo, así que tras esto apuntan automáticamente a la fecha nueva. Es el
// mismo efecto del trigger de reprogramación de la base.
// Requiere cliente service-role (push_subscriptions tiene RLS sin policies). Sólo
// opera vínculos todavía asociados a este turno; la salud del dispositivo vive en
// push_devices y no se modifica al reprogramar.
export const resetPushRemindersForReschedule = async (
	supabase: CitaSupabaseClient,
	input: { businessId: string; appointmentId: string; now?: Date }
): Promise<number> => {
	const now = (input.now ?? new Date()).toISOString();
	const { data, error } = await supabase
		.from('push_subscriptions')
		.update({
			push_24h_claimed_at: null,
			push_24h_sent_at: null,
			push_24h_claim_token: null,
			push_24h_retry_at: null,
			push_24h_failures: 0,
			push_2h_claimed_at: null,
			push_2h_sent_at: null,
			push_2h_claim_token: null,
			push_2h_retry_at: null,
			push_2h_failures: 0,
			updated_at: now
		})
		.eq('business_id', input.businessId)
		.eq('appointment_id', input.appointmentId)
		.is('detached_at', null)
		.select('id');
	if (error) throw error;
	return (data ?? []).length;
};

// Aviso inmediato de reprogramación: una notificación ya MOSTRADA en el navegador no
// se puede borrar sin enviar otro push. Este aviso sale en el momento con el MISMO tag
// que el recordatorio de 24h, así pisa la notificación vieja (horario viejo) aun en
// service workers sin la lógica de `group`, e informa el horario nuevo. No toca los
// flags sent/claimed: los recordatorios de 24h/2h del nuevo horario siguen su curso.
// Requiere cliente service-role (push_subscriptions tiene RLS sin policies). Se
// intenta en toda suscripción vigente: responder la pregunta de prueba sólo afecta
// el refuerzo manual y nunca habilita ni bloquea estas entregas reales.
export const sendReschedulePushNotice = async (
	supabase: CitaSupabaseClient,
	fetchFn: typeof fetch,
	input: { businessId: string; appointmentId: string; now?: Date }
) => {
	if (!isPushConfigured()) return { configured: false, sent: 0, failed: 0, deadEndpoints: 0 };
	const send = createWebPushSender(fetchFn);
	const now = input.now ?? new Date();

	const { data: appointment, error: appointmentError } = await supabase
		.from('appointments')
		.select('id, status, starts_at, public_reminder_description_snapshot, confirmation_token, businesses!inner(name, timezone)')
		.eq('id', input.appointmentId)
		.eq('business_id', input.businessId)
		.maybeSingle();
	if (appointmentError) throw appointmentError;
	if (
		!appointment ||
		!isActiveAppointmentStatus(appointment.status) ||
		new Date(appointment.starts_at) <= now
	) {
		return { configured: true, sent: 0, failed: 0, deadEndpoints: 0 };
	}
	const business = appointment.businesses;

	const { data: subscriptions, error: subscriptionsError } = await supabase
		.from('push_subscriptions')
		.select('id, push_devices!inner(endpoint, p256dh, auth, provider_gone_at)')
		.eq('business_id', input.businessId)
		.eq('appointment_id', input.appointmentId)
		.is('detached_at', null)
		.is('push_devices.provider_gone_at', null);
	if (subscriptionsError) throw subscriptionsError;
	if (!subscriptions || subscriptions.length === 0) {
		return { configured: true, sent: 0, failed: 0, deadEndpoints: 0 };
	}

	const { dateLabel, timeLabel } = formatInTimeZone(
		String(appointment.starts_at),
		String(business.timezone)
	);
	// Payload neutral (§67), como los recordatorios.
	const payload = {
		title: `Turno en ${business.name}`,
		body: `Tu turno fue reprogramado para el ${dateLabel} a las ${timeLabel}.` + (appointment.public_reminder_description_snapshot ? ` ${String(appointment.public_reminder_description_snapshot).slice(0,180)}` : ''),
		url: pushAppointmentPath(String(appointment.confirmation_token)),
		tag: `turno-${input.appointmentId}-24h`,
		group: `turno-${input.appointmentId}`
	};

	let sent = 0;
	let failed = 0;
	let deadEndpoints = 0;
	for (const subscription of subscriptions) {
		const device = subscription.push_devices;
		try {
			const tracked = await sendTrackedPush(supabase, send, {
				businessId: input.businessId,
				appointmentId: input.appointmentId,
				confirmationToken: String(appointment.confirmation_token),
				target: {
					id: String(subscription.id),
					endpoint: String(device.endpoint),
					p256dh: String(device.p256dh),
					auth: String(device.auth)
				},
				kind: 'reschedule',
				payload,
				ttlSeconds: pushTtlUntilAppointment(new Date(appointment.starts_at), now, 24 * 3600),
				topic: pushTopicForAppointment(input.appointmentId),
				now
			});
			if (!tracked.ok) throw tracked.error;
			sent += 1;
		} catch (sendError) {
			failed += 1;
			logServerFailure('Error enviando push de reprogramación', sendError);
			try {
				if (isGoneError(sendError)) {
					await markEndpointGone(supabase, String(device.endpoint), now);
					deadEndpoints += 1;
				}
			} catch (cleanupError) {
				logServerFailure('Error registrando endpoint muerto tras reprogramación', cleanupError);
			}
		}
	}

	if (sent > 0) {
		await writeAuditLog(supabase, {
			businessId: input.businessId,
			userId: null,
			action: 'appointment.push_reschedule_notice',
			entityType: 'appointment',
			entityId: input.appointmentId,
			metadata: { sent, failed }
		});
	}

	return { configured: true, sent, failed, deadEndpoints };
};

export const isGoneError = (error: unknown) =>
	error instanceof PushServiceError && (error.statusCode === 404 || error.statusCode === 410);

export const markEndpointGone = async (
	supabase: CitaSupabaseClient,
	endpoint: string,
	now: Date
) => {
	// Única transición a endpoint muerto: el proveedor respondió 404/410. No se
	// toca ni se "revoca" ningún vínculo por cancelaciones o fallos transitorios.
	const { error } = await supabase.rpc('mark_push_device_gone', {
		target_endpoint: endpoint,
		gone_time: now.toISOString()
	});
	if (error) throw error;
};

// Recordatorios programados ----------------------------------------------------------

const REMINDER_KINDS = ['24h', '2h'] as const;
type ReminderKind = (typeof REMINDER_KINDS)[number];

/** One chunk is prepared, sent and recorded together and never exceeds the parallel calls. */
const PUSH_CHUNK_SIZE = MAX_CONCURRENT_EXTERNAL_CALLS;
/** Largest claim the database accepts in one call. */
const PUSH_MAX_CLAIM = 100;
/** The claim itself and the final advance that records the last results. */
const PUSH_FIXED_CALLS = 2;

type PushBatchOutcome = {
	subscription_id: string;
	kind: ReminderKind;
	delivery_id: string;
	outcome: 'accepted' | 'gone' | 'rejected' | 'transient';
	status_code: number | null;
};

type PreparedReminder = {
	subscriptionId: string;
	kind: ReminderKind;
	appointmentId: string;
	deliveryId: string;
	target: WebPushTarget;
	ttlSeconds: number;
	startsAt: string;
	confirmationToken: string;
	reminderDescription: string | null;
	businessName: string;
	businessTimezone: string;
};

const readPreparedReminder = (value: unknown): PreparedReminder => {
	const item = readRecord(value, 'pushBatch.prepared');
	return {
		subscriptionId: readText(item.subscription_id, 'pushBatch.prepared.subscription'),
		kind: readChoice(item.kind, REMINDER_KINDS, 'pushBatch.prepared.kind'),
		appointmentId: readText(item.appointment_id, 'pushBatch.prepared.appointment'),
		deliveryId: readText(item.delivery_id, 'pushBatch.prepared.delivery'),
		target: {
			endpoint: readText(item.endpoint, 'pushBatch.prepared.endpoint'),
			p256dh: readText(item.p256dh, 'pushBatch.prepared.p256dh'),
			auth: readText(item.auth, 'pushBatch.prepared.auth')
		},
		ttlSeconds: readFiniteNumber(item.ttl_seconds, 'pushBatch.prepared.ttl'),
		startsAt: readText(item.starts_at, 'pushBatch.prepared.startsAt'),
		confirmationToken: readText(item.confirmation_token, 'pushBatch.prepared.token'),
		reminderDescription: readNullableText(item.reminder_description, 'pushBatch.prepared.description'),
		businessName: readText(item.business_name, 'pushBatch.prepared.businessName'),
		businessTimezone: readText(item.business_timezone, 'pushBatch.prepared.timezone')
	};
};

const readPushAdvance = (value: unknown) => {
	const record = readRecord(value, 'pushBatch.advance');
	return {
		released: readFiniteNumber(record.released, 'pushBatch.advance.released'),
		prepared: readArray(record.prepared, 'pushBatch.advance.prepared').map(readPreparedReminder),
		invalidated: readArray(record.invalidated, 'pushBatch.advance.invalidated').length
	};
};

// Payload neutral (§67): sin servicio ni datos clínicos. `group` permite al service
// worker cerrar notificaciones viejas del mismo turno (otro kind).
const reminderPayload = (item: PreparedReminder, receiptToken: string) => {
	const { dateLabel, timeLabel } = formatInTimeZone(item.startsAt, item.businessTimezone);
	const path = pushAppointmentPath(item.confirmationToken);
	return {
		title: `Turno en ${item.businessName}`,
		body:
			`Te recordamos tu turno el ${dateLabel} a las ${timeLabel}.` +
			(item.reminderDescription ? ` ${item.reminderDescription.slice(0, 180)}` : ''),
		url: path,
		tag: `turno-${item.appointmentId}-${item.kind}`,
		group: `turno-${item.appointmentId}`,
		delivery: { id: item.deliveryId, token: receiptToken, receiptUrl: `${path}/push/receipt` }
	};
};

/** Sends one prepared reminder; null when the job deadline came before the request started. */
const deliverReminder = async (
	send: WebPushSender,
	item: PreparedReminder,
	receiptToken: string
): Promise<PushBatchOutcome | null> => {
	const sent = { subscription_id: item.subscriptionId, kind: item.kind, delivery_id: item.deliveryId };
	try {
		const status = await send(item.target, JSON.stringify(reminderPayload(item, receiptToken)), {
			ttlSeconds: item.ttlSeconds,
			topic: pushTopicForAppointment(item.appointmentId)
		});
		return { ...sent, outcome: 'accepted', status_code: status };
	} catch (error) {
		// Never sent: finishing releases its claim and the next preparation closes the attempt.
		if (error instanceof JobBudgetExhaustedError) return null;
		// A lost answer is transient: the provider may have delivered it, and the
		// per-appointment topic and tag collapse a repeated reminder into one.
		return {
			...sent,
			outcome: failureKindFor(error),
			status_code: error instanceof PushServiceError ? error.statusCode : null
		};
	}
};

/**
 * One scheduled push run. The claim shares the queue between practices; each chunk
 * goes through a single database trip that records the previous results and prepares
 * the next reminders (revalidated, with their delivery attempt and live context), and
 * new work starts only while its worst case still fits the budget.
 */
export const sendPushReminderBatch = async (job: ScheduledJobRun) => {
	const summary = { configured: isPushConfigured(), claimed: 0, sent: 0, failed: 0, gone: 0, invalidated: 0, released: 0 };
	if (!summary.configured) return summary;
	const send = createWebPushSender(job.providerFetch);
	const now = job.now.toISOString();
	const claimToken = crypto.randomUUID();
	const chunks = Math.floor((job.budget.remaining() - PUSH_FIXED_CALLS) / (PUSH_CHUNK_SIZE + 1));
	const limit = Math.min(PUSH_MAX_CLAIM, PUSH_CHUNK_SIZE * chunks);
	if (limit < 1) return summary;
	const { data: claimed, error: claimError } = await job.supabase.rpc('claim_push_reminder_batch', {
		p_now: now,
		p_limit: limit,
		p_claim_token: claimToken
	});
	if (claimError) throw claimError;
	const queue = claimed.map((row) => ({
		subscriptionId: row.subscription_id,
		kind: readChoice(row.reminder_kind, REMINDER_KINDS, 'pushBatch.claim.kind')
	}));
	summary.claimed = queue.length;
	let results: PushBatchOutcome[] = [];
	try {
		for (;;) {
			const size = Math.min(PUSH_CHUNK_SIZE, queue.length);
			const chunk =
				size > 0 && job.budget.admits({ calls: 1 + size }, 1)
					? queue.splice(0, size).map((item) => ({ ...item, receiptToken: crypto.randomBytes(32).toString('base64url') }))
					: [];
			const finish = chunk.length === 0;
			if (finish) job.budget.enterFinalization();
			const { data, error } = await job.supabase.rpc('advance_push_reminder_batch', {
				p_claim_token: claimToken,
				p_now: now,
				p_results: results,
				p_next: chunk.map((item) => ({
					subscription_id: item.subscriptionId,
					kind: item.kind,
					receipt_token_hash: hashReceiptToken(item.receiptToken)
				})),
				p_finish: finish
			});
			if (error) throw error;
			results = [];
			const advanced = readPushAdvance(data);
			summary.invalidated += advanced.invalidated;
			summary.released += advanced.released;
			if (finish) return summary;
			const sends = advanced.prepared.map((item) => {
				const requested = chunk.find((entry) => entry.subscriptionId === item.subscriptionId && entry.kind === item.kind);
				if (!requested) throw new InvalidDataContractError('pushBatch.prepared.unrequested');
				return { item, receiptToken: requested.receiptToken };
			});
			for (const outcome of await Promise.all(sends.map(({ item, receiptToken }) => deliverReminder(send, item, receiptToken)))) {
				if (!outcome) continue;
				results.push(outcome);
				if (outcome.outcome === 'accepted') summary.sent += 1;
				else if (outcome.outcome === 'gone') summary.gone += 1;
				else summary.failed += 1;
			}
		}
	} catch (error) {
		// Record what was sent and release the rest; abandoned claims also expire on their own.
		try {
			job.budget.enterFinalization();
			const { error: releaseError } = await job.supabase.rpc('advance_push_reminder_batch', {
				p_claim_token: claimToken,
				p_now: now,
				p_results: results,
				p_next: [],
				p_finish: true
			});
			if (releaseError) throw releaseError;
		} catch (releaseError) {
			logServerFailure('Error cerrando el lote de recordatorios push', releaseError);
		}
		throw error;
	}
};

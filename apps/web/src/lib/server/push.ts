// Recordatorios Web Push para navegadores compatibles (este flujo nunca se ofrece en iOS).
//
// Confiabilidad del envío: claim atómico vía RPC claim_due_push_reminders
// (FOR UPDATE SKIP LOCKED + reclaim a los 10 min si el proceso murió entre claim y
// envío). sent_at se marca SOLO tras envío exitoso: un fallo transitorio reintenta
// en el próximo run en vez de perder el recordatorio.

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import webpush from 'web-push';
import crypto from 'node:crypto';
import { isIP } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './audit';
import { formatInTimeZone } from '$lib/utils/format';
import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';
import { addMinutes } from './appointments';
import type { PublicAppointmentView } from './public-appointments';

const TEST_PUSH_TTL_SECONDS = 5 * 60;
const PUSH_TELEMETRY_RETENTION_DAYS = 90;
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

let vapidConfigured = false;
const ensureVapid = () => {
	if (vapidConfigured) return;
	const publicKey = getVapidPublicKey();
	const privateKey = env.VAPID_PRIVATE_KEY?.trim();
	if (!publicKey || !privateKey) throw new Error('PUSH_NOT_CONFIGURED');
	webpush.setVapidDetails(env.VAPID_SUBJECT?.trim() || 'mailto:soporte@example.com', publicKey, privateKey);
	vapidConfigured = true;
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

export const isValidPushDeliveryId = (value: string) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value
	);

export const isValidPushTestRequestKey = (value: string) =>
	/^[A-Za-z0-9:_-]{16,180}$/.test(value);

export const isValidSubscriptionPayload = (raw: unknown): raw is PushSubscriptionPayload => {
	const candidate = raw as PushSubscriptionPayload | null;
	if (
		!candidate ||
		typeof candidate.endpoint !== 'string' ||
		candidate.endpoint.length > 2048 ||
		!candidate.keys ||
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
	supabase: SupabaseClient,
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
	const saved = data as
		| {
				subscription_id: string;
				endpoint: string;
				verification_confirmed_at: string | null;
				provider_gone: boolean;
		  }
		| null;
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

const deliveryState = (row: any, now: Date): PushDeliveryState => {
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

const toDeliveryStatus = (row: any, now = new Date()): PushDeliveryStatus => ({
	deliveryId: String(row.id),
	state: deliveryState(row, now),
	kind: row.kind as PushDeliveryKind,
	createdAt: String(row.created_at),
	expiresAt: String(row.expires_at)
});

export const getPushDeliveryStatus = async (
	supabase: SupabaseClient,
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
	supabase: SupabaseClient,
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
	supabase: SupabaseClient,
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
	supabase: SupabaseClient,
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

export const failureKindFor = (error: unknown): 'gone' | 'rejected' | 'transient' => {
	const statusCode = Number((error as { statusCode?: number })?.statusCode ?? 0);
	if (statusCode === 404 || statusCode === 410) return 'gone';
	if (statusCode >= 400 && statusCode < 500) return 'rejected';
	return 'transient';
};

export const sendTrackedPush = async (
	supabase: SupabaseClient,
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
	ensureVapid();
	const receiptToken = crypto.randomBytes(32).toString('base64url');
	const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000).toISOString();
	let deliveryId: string | null = null;

	// La telemetría no debe impedir los recordatorios programados. La prueba visible,
	// en cambio, exige una fila durable: sin ella no podríamos garantizar que dos
	// eventos de foco representen una sola entrega lógica.
	try {
		const { data, error } = await supabase
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
		if (error) throw error;
		deliveryId = data?.id ? String(data.id) : null;
	} catch (trackingError) {
		const typedTrackingError = trackingError as {
			code?: string;
			message?: string;
			details?: string;
		};
		const errorCode = String(typedTrackingError?.code ?? '');
		const errorText = `${errorCode} ${typedTrackingError?.message ?? ''} ${
			typedTrackingError?.details ?? ''
		}`;
		if (
			errorText.includes('PUSH_SUBSCRIPTION_DETACHED') ||
			errorText.includes('PUSH_DEVICE_GONE') ||
			errorText.includes('PUSH_SUBSCRIPTION_REVOKED') ||
			errorText.includes('PUSH_SUBSCRIPTION_MISMATCH') ||
			errorText.includes('PUSH_SUBSCRIPTION_NOT_FOUND')
		) {
			// Una reparación o desvinculación ganó la carrera. Enviar sin un intento
			// durable podría avisar al paciente que ya no corresponde a este turno.
			return { ok: false, deliveryId: null, error: trackingError };
		}
		if (input.googleReviewRequestId && errorCode === '23505') {
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
					.maybeSingle();
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
				console.error('Error reconciliando entrega de reseña', lookupError);
			}
			return {
				ok: false,
				deliveryId: null,
				error: { statusCode: 503, code: 'PUSH_REVIEW_DELIVERY_OUTCOME_UNKNOWN' }
			};
		}
		if (input.requestKeyHash && errorCode === '23505') {
			try {
				const { data: existing, error: existingError } = await supabase
					.from('push_delivery_attempts')
					.select('id, push_service_status, failed_at, failure_kind')
					.eq('subscription_id', input.target.id)
					.eq('request_key_hash', input.requestKeyHash)
					.eq('kind', input.kind)
					.maybeSingle();
				if (existingError) throw existingError;
				if (existing?.id) {
					if (existing.failed_at) {
						return {
							ok: false,
							deliveryId: String(existing.id),
							error: {
								statusCode: existing.failure_kind === 'gone' ? 410 : 503,
								code: `PUSH_TEST_${String(existing.failure_kind ?? 'FAILED').toUpperCase()}`
							}
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
				console.error('Error recuperando prueba push idempotente', lookupError);
			}
		}
		console.error('Error creando seguimiento de push', trackingError);
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
		const response = await webpush.sendNotification(
			{
				endpoint: input.target.endpoint,
				keys: { p256dh: input.target.p256dh, auth: input.target.auth }
			},
			JSON.stringify({ ...input.payload, ...(delivery ? { delivery } : {}) }),
			{ TTL: input.ttlSeconds, urgency: 'high', topic: input.topic }
		);
		const pushServiceStatus = Number((response as { statusCode?: number })?.statusCode ?? 0) || null;
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
			if (error) console.error('Error registrando aceptación del push', error);
		}
		return { ok: true, deliveryId, pushServiceStatus };
	} catch (error) {
		if (deliveryId) {
			const failedAt = new Date().toISOString();
			const statusCode = Number((error as { statusCode?: number })?.statusCode ?? 0) || null;
			const { error: trackingError } = await supabase
				.from('push_delivery_attempts')
				.update({
					failed_at: failedAt,
					failure_kind: failureKindFor(error),
					push_service_status: statusCode,
					updated_at: failedAt
				})
				.eq('id', deliveryId);
			if (trackingError) console.error('Error registrando fallo del push', trackingError);
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
	supabase: SupabaseClient,
	input: {
		appointment: PublicAppointmentView;
		subscription: TrackedPushTarget;
		requestKey?: string;
		now?: Date;
	}
) => {
	if (!isPushConfigured()) return { configured: false, accepted: false, deliveryId: null };
	ensureVapid();
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
		console.error('Error consultando prueba push reciente', trackingError);
	}
	const result = await sendTrackedPush(supabase, {
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
// reenvío (el job no reenvía si sent_at ya está marcado) y limpiar *_claimed_at
// libera cualquier claim en vuelo; las ventanas se computan en claim_due_push_reminders
// contra el starts_at vivo, así que tras esto apuntan automáticamente a la fecha nueva.
// Requiere cliente service-role (push_subscriptions tiene RLS sin policies). Sólo
// opera vínculos todavía asociados a este turno; la salud del dispositivo vive en
// push_devices y no se modifica al reprogramar.
export const resetPushRemindersForReschedule = async (
	supabase: SupabaseClient,
	input: { businessId: string; appointmentId: string; now?: Date }
): Promise<number> => {
	const now = (input.now ?? new Date()).toISOString();
	const { data, error } = await supabase
		.from('push_subscriptions')
		.update({
			push_24h_claimed_at: null,
			push_24h_sent_at: null,
			push_2h_claimed_at: null,
			push_2h_sent_at: null,
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
	supabase: SupabaseClient,
	input: { businessId: string; appointmentId: string; now?: Date }
) => {
	if (!isPushConfigured()) return { configured: false, sent: 0, failed: 0, deadEndpoints: 0 };
	ensureVapid();
	const now = input.now ?? new Date();

	const { data: appointment, error: appointmentError } = await supabase
		.from('appointments')
		.select('id, status, starts_at, public_reminder_description_snapshot, confirmation_token, businesses!inner(name, timezone)')
		.eq('id', input.appointmentId)
		.eq('business_id', input.businessId)
		.maybeSingle();
	if (appointmentError) throw appointmentError;
	const business = (appointment as any)?.businesses;
	if (
		!appointment ||
		!isActiveAppointmentStatus(appointment.status) ||
		new Date(appointment.starts_at) <= now
	) {
		return { configured: true, sent: 0, failed: 0, deadEndpoints: 0 };
	}

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
		const device = (subscription as any).push_devices;
		try {
			const tracked = await sendTrackedPush(supabase, {
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
			console.error('Error enviando push de reprogramación', sendError);
			try {
				if (isGoneError(sendError)) {
					await markEndpointGone(supabase, String(device.endpoint), now);
					deadEndpoints += 1;
				}
			} catch (cleanupError) {
				console.error('Error registrando endpoint muerto tras reprogramación', cleanupError);
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

type ClaimedReminder = {
	subscription_id: string;
	appointment_id: string;
	business_id: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	reminder_kind: '24h' | '2h';
};

// Mismas ventanas que claim_due_push_reminders, evaluadas contra el starts_at VIVO:
// si una reprogramación corrió entre el claim y el envío, el turno puede haber salido
// de la ventana del kind reclamado. Enviar igual consumiría el sent_at con días de
// anticipación y el recordatorio real nunca saldría.
const isWithinReminderWindow = (kind: '24h' | '2h', startsAt: Date, now: Date) =>
	kind === '24h'
		? startsAt > addMinutes(now, 2 * 60) && startsAt <= addMinutes(now, 24 * 60)
		: startsAt > now && startsAt <= addMinutes(now, 2 * 60);

export const isGoneError = (error: unknown) => {
	const statusCode = (error as { statusCode?: number })?.statusCode;
	return statusCode === 404 || statusCode === 410;
};

export const markEndpointGone = async (
	supabase: SupabaseClient,
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

const releaseClaim = async (
	supabase: SupabaseClient,
	claimed: ClaimedReminder,
	failedCount: number,
	now: Date
) => {
	const updates: Record<string, unknown> = {
		failed_count: failedCount,
		updated_at: now.toISOString(),
		[claimed.reminder_kind === '24h' ? 'push_24h_claimed_at' : 'push_2h_claimed_at']: null
	};
	const { error } = await supabase
		.from('push_subscriptions')
		.update(updates)
		.eq('id', claimed.subscription_id);
	if (error) throw error;
};

export const sendDuePushReminders = async (
	supabase: SupabaseClient,
	input: { now?: Date; limit?: number } = {}
) => {
	if (!isPushConfigured()) {
		return { configured: false, claimed: 0, sent: 0, failed: 0, deadEndpoints: 0 };
	}
	ensureVapid();
	const now = input.now ?? new Date();
	const retentionCutoff = new Date(
		now.getTime() - PUSH_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000
	).toISOString();
	const { error: telemetryCleanupError } = await supabase
		.from('push_delivery_attempts')
		.delete()
		.lt('created_at', retentionCutoff);
	if (telemetryCleanupError) {
		console.error('Error limpiando seguimiento histórico de push', telemetryCleanupError);
	}

	let deadEndpoints = 0;

	const { data: claimedRows, error: claimError } = await supabase.rpc('claim_due_push_reminders', {
		claim_now: now.toISOString(),
		claim_limit: input.limit ?? 50
	});
	if (claimError) throw claimError;

	let sent = 0;
	let failed = 0;

	for (const claimed of (claimedRows ?? []) as ClaimedReminder[]) {
		try {
			// Revalidación con el estado vivo: el claim pudo correr justo antes de una
			// cancelación o reprogramación.
			const { data: appointment, error: appointmentError } = await supabase
				.from('appointments')
				.select(
					'id, status, starts_at, public_reminder_description_snapshot, confirmation_token, businesses!inner(name, timezone)'
				)
				.eq('id', claimed.appointment_id)
				.eq('business_id', claimed.business_id)
				.maybeSingle();
			if (appointmentError) throw appointmentError;
			const business = (appointment as any)?.businesses;
			if (
				!appointment ||
				!isActiveAppointmentStatus(appointment.status) ||
				!isWithinReminderWindow(claimed.reminder_kind, new Date(appointment.starts_at), now)
			) {
				await releaseClaim(supabase, claimed, 0, now);
				continue;
			}

			const { dateLabel, timeLabel } = formatInTimeZone(
				String(appointment.starts_at),
				String(business.timezone)
			);
			// Payload neutral (§67): sin servicio, sin datos clínicos. `group` permite al
			// service worker cerrar notificaciones viejas del mismo turno (otro kind).
			const payload = {
				title: `Turno en ${business.name}`,
				body: `Te recordamos tu turno el ${dateLabel} a las ${timeLabel}.` + (appointment.public_reminder_description_snapshot ? ` ${String(appointment.public_reminder_description_snapshot).slice(0,180)}` : ''),
				url: pushAppointmentPath(String(appointment.confirmation_token)),
				tag: `turno-${claimed.appointment_id}-${claimed.reminder_kind}`,
				group: `turno-${claimed.appointment_id}`
			};

			const tracked = await sendTrackedPush(supabase, {
				businessId: claimed.business_id,
				appointmentId: claimed.appointment_id,
				confirmationToken: String(appointment.confirmation_token),
				target: {
					id: claimed.subscription_id,
					endpoint: claimed.endpoint,
					p256dh: claimed.p256dh,
					auth: claimed.auth
				},
				kind: claimed.reminder_kind,
				payload,
				ttlSeconds: pushTtlUntilAppointment(
					new Date(appointment.starts_at),
					now,
					claimed.reminder_kind === '24h' ? 24 * 3600 : 2 * 3600
				),
				topic: pushTopicForAppointment(claimed.appointment_id),
				now
			});
			if (!tracked.ok) throw tracked.error;

			const { error: sentUpdateError } = await supabase
				.from('push_subscriptions')
				.update({
					[claimed.reminder_kind === '24h' ? 'push_24h_sent_at' : 'push_2h_sent_at']:
						now.toISOString(),
					failed_count: 0,
					updated_at: now.toISOString()
				})
				.eq('id', claimed.subscription_id);
			if (sentUpdateError) throw sentUpdateError;

			await writeAuditLog(supabase, {
				businessId: claimed.business_id,
				userId: null,
				action: 'appointment.push_sent',
				entityType: 'appointment',
				entityId: claimed.appointment_id,
				metadata: { reminder_kind: claimed.reminder_kind }
			});
			sent += 1;
		} catch (sendError) {
			failed += 1;
			console.error('Error enviando push de recordatorio', sendError);
			try {
				if (isGoneError(sendError)) {
					await markEndpointGone(supabase, claimed.endpoint, now);
					deadEndpoints += 1;
				} else {
					const { data: current } = await supabase
						.from('push_subscriptions')
						.select('failed_count')
						.eq('id', claimed.subscription_id)
						.maybeSingle();
					await releaseClaim(
						supabase,
						claimed,
						Number(current?.failed_count ?? 0) + 1,
						now
					);
				}
			} catch (cleanupError) {
				console.error('Error liberando claim de push', cleanupError);
			}
		}
	}

	return {
		configured: true,
		claimed: claimedRows?.length ?? 0,
		sent,
		failed,
		deadEndpoints
	};
};

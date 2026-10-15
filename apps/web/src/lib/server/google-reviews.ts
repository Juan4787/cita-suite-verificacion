import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './audit';
import {
	failureKindFor,
	isGoneError,
	isPushConfigured,
	markEndpointGone,
	pushTopicForAppointment,
	sendTrackedPush
} from './push';

const REVIEW_PUSH_TTL_SECONDS = 24 * 60 * 60;

type ClaimedGoogleReviewRequest = {
	request_id: string;
	claim_token: string;
	business_id: string;
	patient_id: string;
	appointment_id: string;
	appointment_ends_at: string;
	scheduled_for: string;
	subscription_id: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	confirmation_token: string;
};

type AcceptedGoogleReviewDelivery = {
	id: string;
	push_service_status: number | null;
};

const hashClickToken = (token: string) =>
	crypto.createHash('sha256').update(token).digest('hex');

const releaseRequest = async (
	supabase: SupabaseClient,
	request: ClaimedGoogleReviewRequest,
	errorKind: string,
	now: Date
) => {
	const { error } = await supabase.rpc('release_google_review_request', {
		target_request_id: request.request_id,
		target_claim_token: request.claim_token,
		target_error_kind: errorKind.slice(0, 80),
		release_time: now.toISOString()
	});
	if (error) throw error;
};

const requestStillClaimed = async (
	supabase: SupabaseClient,
	request: ClaimedGoogleReviewRequest
) => {
	const { data, error } = await supabase
		.from('google_review_requests')
		.select('status, claim_token')
		.eq('id', request.request_id)
		.maybeSingle();
	if (error) throw error;
	return data?.status === 'claimed' && data.claim_token === request.claim_token;
};

const acceptedDeliveryFor = async (
	supabase: SupabaseClient,
	requestId: string
): Promise<AcceptedGoogleReviewDelivery | null> => {
	const { data, error } = await supabase
		.from('push_delivery_attempts')
		.select('id, push_service_status, accepted_at, failed_at, superseded_at')
		.eq('google_review_request_id', requestId)
		.eq('kind', 'review')
		.is('failed_at', null)
		.is('superseded_at', null)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	if (!data?.id || !data.accepted_at) return null;
	return {
		id: String(data.id),
		push_service_status: Number(data.push_service_status ?? 0) || null
	};
};

const completeRequest = async (
	supabase: SupabaseClient,
	request: ClaimedGoogleReviewRequest,
	delivery: AcceptedGoogleReviewDelivery,
	now: Date
) => {
	const { data, error } = await supabase.rpc('complete_google_review_request', {
		target_request_id: request.request_id,
		target_claim_token: request.claim_token,
		target_push_delivery_id: delivery.id,
		target_push_service_status: delivery.push_service_status,
		complete_time: now.toISOString()
	});
	if (error) throw error;
	if (data !== true) throw new Error('GOOGLE_REVIEW_COMPLETION_REJECTED');
};

const auditCompletedRequest = async (
	supabase: SupabaseClient,
	request: ClaimedGoogleReviewRequest
) => {
	try {
		await writeAuditLog(supabase, {
			businessId: request.business_id,
			userId: null,
			action: 'appointment.google_review_requested',
			entityType: 'appointment',
			entityId: request.appointment_id,
			metadata: {
				request_id: request.request_id,
				scheduled_for: request.scheduled_for
			}
		});
	} catch (auditError) {
		// La entrega y el cooldown ya quedaron cerrados atómicamente. Un fallo de
		// auditoría no debe convertirlos en un reenvío ni falsear el resultado.
		console.error('Error auditando solicitud de reseña enviada', {
			requestId: request.request_id,
			code: auditError instanceof Error ? auditError.message.slice(0, 120) : 'unknown'
		});
	}
};

export const sendDueGoogleReviewRequests = async (
	supabase: SupabaseClient,
	input: { now?: Date; limit?: number } = {}
) => {
	if (!isPushConfigured()) {
		return {
			configured: false,
			claimed: 0,
			sent: 0,
			failed: 0,
			invalidated: 0,
			deadEndpoints: 0
		};
	}

	const now = input.now ?? new Date();
	const { error: recoveryError } = await supabase.rpc(
		'recover_expired_google_review_request_claims',
		{ recover_time: now.toISOString() }
	);
	if (recoveryError) throw recoveryError;
	const { data, error } = await supabase.rpc('claim_due_google_review_requests', {
		claim_now: now.toISOString(),
		claim_limit: input.limit ?? 20
	});
	if (error) throw error;

	const claimed = (data ?? []) as ClaimedGoogleReviewRequest[];
	let sent = 0;
	let failed = 0;
	let invalidated = 0;
	let deadEndpoints = 0;

	for (const request of claimed) {
		let deliveryAccepted = false;
		try {
			// Si el proveedor ya había aceptado la entrega y sólo falló el cierre de
			// base, se completa el mismo intento. Nunca se genera una segunda push.
			const acceptedDelivery = await acceptedDeliveryFor(supabase, request.request_id);
			if (acceptedDelivery) {
				deliveryAccepted = true;
				await completeRequest(supabase, request, acceptedDelivery, now);
				sent += 1;
				await auditCompletedRequest(supabase, request);
				continue;
			}

			const clickToken = crypto.randomBytes(32).toString('base64url');
			const { data: prepared, error: prepareError } = await supabase
				.rpc('prepare_google_review_request_delivery', {
					target_request_id: request.request_id,
					target_claim_token: request.claim_token,
					target_subscription_id: request.subscription_id,
					target_click_token_hash: hashClickToken(clickToken),
					prepare_time: now.toISOString()
				})
				.maybeSingle();
			if (prepareError) throw prepareError;
			const snapshot = prepared as
				| {
						notification_title: string;
						notification_body: string;
						notification_action_label: string;
				  }
				| null;
			if (!snapshot || !(await requestStillClaimed(supabase, request))) {
				invalidated += 1;
				continue;
			}

			const tracked = await sendTrackedPush(supabase, {
				businessId: request.business_id,
				appointmentId: request.appointment_id,
				confirmationToken: request.confirmation_token,
				target: {
					id: request.subscription_id,
					endpoint: request.endpoint,
					p256dh: request.p256dh,
					auth: request.auth
				},
				kind: 'review',
				payload: {
					title: snapshot.notification_title,
					body: snapshot.notification_body,
					url: `/r/${clickToken}`,
					tag: `turno-${request.appointment_id}-review`,
					group: `turno-${request.appointment_id}`,
					actions: [
						{
							action: 'google-review',
							title: snapshot.notification_action_label
						}
					]
				},
				ttlSeconds: REVIEW_PUSH_TTL_SECONDS,
				topic: pushTopicForAppointment(request.appointment_id, 'review'),
				now,
				googleReviewRequestId: request.request_id,
				requireTracking: true
			});
			if (!tracked.ok) throw tracked.error;
			if (!tracked.deliveryId) throw new Error('GOOGLE_REVIEW_DELIVERY_NOT_TRACKED');
			deliveryAccepted = true;
			await completeRequest(
				supabase,
				request,
				{ id: tracked.deliveryId, push_service_status: tracked.pushServiceStatus },
				now
			);
			sent += 1;
			await auditCompletedRequest(supabase, request);
		} catch (sendError) {
			failed += 1;
			const failureKind = failureKindFor(sendError);
			const failureCode = String(
				(sendError as { code?: unknown } | null)?.code ?? ''
			);
			console.error('Error enviando solicitud de reseña', {
				requestId: request.request_id,
				failureKind,
				failureCode: failureCode.slice(0, 80)
			});
			try {
				// El proveedor ya aceptó la notificación: liberar habilitaría un posible
				// duplicado. Un intento de resultado incierto tampoco se libera: al vencer
				// el lease, la base lo cierra de forma conservadora sin volver a enviarlo.
				if (
					deliveryAccepted ||
					failureCode === 'PUSH_REVIEW_DELIVERY_OUTCOME_UNKNOWN'
				) {
					continue;
				}
				if (isGoneError(sendError)) {
					await markEndpointGone(supabase, request.endpoint, now);
					deadEndpoints += 1;
				}
				await releaseRequest(supabase, request, failureKind, now);
			} catch (cleanupError) {
				console.error('Error liberando solicitud de reseña', {
					requestId: request.request_id,
					code: cleanupError instanceof Error ? cleanupError.message.slice(0, 120) : 'unknown'
				});
			}
		}
	}

	return {
		configured: true,
		claimed: claimed.length,
		sent,
		failed,
		invalidated,
		deadEndpoints
	};
};

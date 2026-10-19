import { logServerFailure } from '$lib/server/platform/logging';
import crypto from 'node:crypto';
import type { CitaSupabaseClient } from '$lib/types/database';
import { insertAuditLog } from '$lib/server/platform/audit';
import type { ScheduledJobRun } from '$lib/server/integrations/internal/job-budget';
import {
	PushServiceError,
	createWebPushSender,
	failureKindFor,
	isGoneError,
	isPushConfigured,
	markEndpointGone,
	pushTopicForAppointment,
	sendTrackedPush,
	type WebPushSender
} from '$lib/server/integrations/public/push';

const REVIEW_PUSH_TTL_SECONDS = 24 * 60 * 60;
/**
 * Worst case of one request: accepted delivery check, preparation, claim check,
 * attempt, send and its outcome, then completion and audit, or the device and the
 * release after a failed send.
 */
const REVIEW_REQUEST_CALLS = 8;
/** Recovery of expired claims and the claim itself. */
const REVIEW_FIXED_CALLS = 2;
/** Largest claim the database accepts in one call. */
const REVIEW_MAX_CLAIM = 100;

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
	supabase: CitaSupabaseClient,
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
	supabase: CitaSupabaseClient,
	request: ClaimedGoogleReviewRequest
) => {
	const { data, error } = await supabase
		.from('google_review_requests')
		.select('status, claim_token')
		.eq('id', request.request_id)
		.maybeSingle()
		.retry(false);
	if (error) throw error;
	return data?.status === 'claimed' && data.claim_token === request.claim_token;
};

const acceptedDeliveryFor = async (
	supabase: CitaSupabaseClient,
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
		.maybeSingle()
		.retry(false);
	if (error) throw error;
	if (!data?.id || !data.accepted_at) return null;
	return {
		id: String(data.id),
		push_service_status: Number(data.push_service_status ?? 0) || null
	};
};

const completeRequest = async (
	supabase: CitaSupabaseClient,
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

// La entrega y el cooldown ya quedaron cerrados atómicamente: la auditoría es de
// mejor esfuerzo y nunca los convierte en un reenvío ni falsea el resultado.
const auditCompletedRequest = (supabase: CitaSupabaseClient, request: ClaimedGoogleReviewRequest) =>
	insertAuditLog(supabase, {
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

type RequestOutcome = 'sent' | 'failed' | 'invalidated' | 'gone';

const processRequest = async (
	supabase: CitaSupabaseClient,
	send: WebPushSender,
	request: ClaimedGoogleReviewRequest,
	now: Date
): Promise<RequestOutcome> => {
	let deliveryAccepted = false;
	try {
		// Si el proveedor ya había aceptado la entrega y sólo falló el cierre de
		// base, se completa el mismo intento. Nunca se genera una segunda push.
		const acceptedDelivery = await acceptedDeliveryFor(supabase, request.request_id);
		if (acceptedDelivery) {
			deliveryAccepted = true;
			await completeRequest(supabase, request, acceptedDelivery, now);
			await auditCompletedRequest(supabase, request);
			return 'sent';
		}

		const clickToken = crypto.randomBytes(32).toString('base64url');
		const { data: snapshot, error: prepareError } = await supabase
			.rpc('prepare_google_review_request_delivery', {
				target_request_id: request.request_id,
				target_claim_token: request.claim_token,
				target_subscription_id: request.subscription_id,
				target_click_token_hash: hashClickToken(clickToken),
				prepare_time: now.toISOString()
			})
			.maybeSingle();
		if (prepareError) throw prepareError;
		if (!snapshot || !(await requestStillClaimed(supabase, request))) return 'invalidated';

		const tracked = await sendTrackedPush(supabase, send, {
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
		await auditCompletedRequest(supabase, request);
		return 'sent';
	} catch (sendError) {
		const failureKind = failureKindFor(sendError);
		const failureCode = sendError instanceof PushServiceError ? (sendError.code ?? '') : '';
		logServerFailure('Error enviando solicitud de reseña', sendError);
		try {
			// El proveedor ya aceptó la notificación: liberar habilitaría un posible
			// duplicado. Un intento de resultado incierto tampoco se libera: al vencer
			// el lease, la base lo cierra de forma conservadora sin volver a enviarlo.
			if (deliveryAccepted || failureCode === 'PUSH_REVIEW_DELIVERY_OUTCOME_UNKNOWN') {
				return 'failed';
			}
			const gone = isGoneError(sendError);
			if (gone) await markEndpointGone(supabase, request.endpoint, now);
			await releaseRequest(supabase, request, failureKind, now);
			return gone ? 'gone' : 'failed';
		} catch (cleanupError) {
			logServerFailure('Error liberando solicitud de reseña', cleanupError);
			return 'failed';
		}
	}
};

/**
 * One scheduled review run: one turn per practice from the batch claim, and a request
 * starts only while its worst case still fits the budget. A request left out keeps its
 * claim until it expires; the recovery of the next run returns it to the queue.
 */
export const sendGoogleReviewRequestBatch = async (job: ScheduledJobRun) => {
	const summary = { configured: isPushConfigured(), claimed: 0, sent: 0, failed: 0, invalidated: 0, deadEndpoints: 0 };
	if (!summary.configured) return summary;
	const limit = Math.min(
		REVIEW_MAX_CLAIM,
		Math.floor((job.budget.remaining() - REVIEW_FIXED_CALLS) / REVIEW_REQUEST_CALLS)
	);
	if (limit < 1) return summary;
	const now = job.now.toISOString();
	const { error: recoveryError } = await job.supabase.rpc('recover_expired_google_review_request_claims', {
		recover_time: now
	});
	if (recoveryError) throw recoveryError;
	const { data: claimed, error } = await job.supabase.rpc('claim_google_review_request_batch', {
		claim_now: now,
		claim_limit: limit
	});
	if (error) throw error;
	summary.claimed = claimed.length;
	const send = createWebPushSender(job.providerFetch);
	for (const request of claimed) {
		if (!job.budget.admits({ calls: REVIEW_REQUEST_CALLS }, 0)) break;
		const outcome = await processRequest(job.supabase, send, request, job.now);
		if (outcome === 'sent') summary.sent += 1;
		else if (outcome === 'invalidated') summary.invalidated += 1;
		else {
			summary.failed += 1;
			if (outcome === 'gone') summary.deadEndpoints += 1;
		}
	}
	return summary;
};

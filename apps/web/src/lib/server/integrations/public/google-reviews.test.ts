import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {
		VAPID_PUBLIC_KEY: 'test-public-key',
		VAPID_PRIVATE_KEY: 'test-private-key',
		VAPID_SUBJECT: 'mailto:test@example.com'
	} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>
}));
const mocks = vi.hoisted(() => ({ insertAuditLog: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));
// The plain payload travels in the request so the test reads what the patient receives.
vi.mock('web-push', () => ({
	default: {
		getVapidHeaders: vi.fn(() => ({ Authorization: 'vapid t=test-jwt, k=test-public-key' })),
		generateRequestDetails: vi.fn(
			(subscription: { endpoint: string }, payload: string, options: { headers: Record<string, string> }) => ({
				method: 'POST',
				endpoint: subscription.endpoint,
				headers: { ...options.headers },
				body: Buffer.from(payload)
			})
		)
	}
}));
vi.mock('$lib/server/platform/audit', () => ({ insertAuditLog: mocks.insertAuditLog }));

import webpush from 'web-push';
import { WORK_DEADLINE_MS, createJobBudget } from '$lib/server/integrations/internal/job-budget';
import { sendGoogleReviewRequestBatch } from '$lib/server/integrations/public/google-reviews';
import { pushTopicForAppointment } from '$lib/server/integrations/public/push';

const now = new Date('2026-08-24T18:00:00.000Z');
const claim = {
	request_id: '10000000-0000-4000-8000-000000000001',
	claim_token: '20000000-0000-4000-8000-000000000002',
	business_id: '30000000-0000-4000-8000-000000000003',
	patient_id: '40000000-0000-4000-8000-000000000004',
	appointment_id: '50000000-0000-4000-8000-000000000005',
	appointment_ends_at: '2026-08-24T16:00:00.000Z',
	scheduled_for: now.toISOString(),
	subscription_id: '60000000-0000-4000-8000-000000000006',
	endpoint: 'https://push.example/device',
	p256dh: 'p256dh-key',
	auth: 'auth-key',
	confirmation_token: 'appointment-token'
};
const prepared = {
	review_url: 'https://g.page/r/AbCdEf123/review',
	notification_title: '✨ Experiencia',
	notification_body: 'Compartí tu opinión en Google.',
	notification_action_label: 'Compartir mi opinión'
};

const createSupabase = (options: {
	prepareData?: typeof prepared | null;
	liveStatus?: string;
	complete?: boolean;
	acceptedDelivery?: {
		id: string;
		push_service_status: number | null;
		accepted_at: string | null;
		failed_at: null;
		superseded_at: null;
	} | null;
	trackingInsertError?: { code: string; message: string };
	claimed?: (typeof claim)[];
} = {}) => {
	const rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
	const inserts: Array<Record<string, unknown>> = [];
	const updates: Array<Record<string, unknown>> = [];

	const rpcResult = (name: string) => {
		if (name === 'claim_google_review_request_batch') return { data: options.claimed ?? [claim], error: null };
		if (name === 'prepare_google_review_request_delivery') {
			return { data: options.prepareData === undefined ? prepared : options.prepareData, error: null };
		}
		if (name === 'complete_google_review_request') {
			return { data: options.complete ?? true, error: null };
		}
		if (name === 'mark_push_device_gone') return { data: 1, error: null };
		if (name === 'release_google_review_request') return { data: true, error: null };
		return { data: null, error: null };
	};

	const supabase = {
		rpc(name: string, args?: Record<string, unknown>) {
			rpcCalls.push({ name, args });
			const result = rpcResult(name);
			return {
				single: async () => result,
				maybeSingle: async () => result,
				then: (resolve: (value: typeof result) => unknown) =>
					Promise.resolve(result).then(resolve)
			};
		},
		from(table: string) {
			let result: {
				data: unknown;
				error: null | { code: string; message: string };
			} =
				table === 'google_review_requests'
					? {
							data: {
								status: options.liveStatus ?? 'claimed',
								claim_token: claim.claim_token
							},
							error: null
						}
					: table === 'push_delivery_attempts' && options.acceptedDelivery
						? { data: options.acceptedDelivery as unknown, error: null }
						: { data: null as unknown, error: null };
			const chain: any = {
				select: () => chain,
				eq: () => chain,
				is: () => chain,
				order: () => chain,
				limit: () => chain,
				retry: () => chain,
				insert: (payload: Record<string, unknown>) => {
					inserts.push(payload);
					result = options.trackingInsertError
						? { data: null, error: options.trackingInsertError }
						: {
								data: { id: '70000000-0000-4000-8000-000000000007' },
								error: null
							};
					return chain;
				},
				update: (payload: Record<string, unknown>) => {
					updates.push(payload);
					result = { data: null, error: null };
					return chain;
				},
				maybeSingle: () => chain,
				single: () => chain,
				then: (resolve: (value: typeof result) => unknown) =>
					Promise.resolve(result).then(resolve)
			};
			return chain;
		}
	} as any;

	return { supabase, rpcCalls, inserts, updates };
};

// Push service double: records each request and answers with the given status.
const pushService = (answer: () => Response | Promise<Response> = () => new Response(null, { status: 201 })) => {
	const requests: Request[] = [];
	const fetchFn: typeof fetch = async (input, init) => {
		requests.push(new Request(input, init));
		return answer();
	};
	return { fetchFn, requests };
};

const run = (supabase: unknown, service: ReturnType<typeof pushService>, budget = createJobBudget('free')) =>
	sendGoogleReviewRequestBatch({ supabase: supabase as any, budget, providerFetch: service.fetchFn, now });

beforeEach(() => {
	vi.clearAllMocks();
});

describe('sendGoogleReviewRequestBatch', () => {
	it('envía el mensaje editable, registra una sola entrega y completa el cooldown', async () => {
		const { supabase, rpcCalls, inserts } = createSupabase();
		const service = pushService();
		const result = await run(supabase, service);

		expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0, invalidated: 0 });
		expect(service.requests).toHaveLength(1);
		const payload = JSON.parse(await service.requests[0].text());
		expect(payload).toMatchObject({
			title: prepared.notification_title,
			body: prepared.notification_body,
			tag: `turno-${claim.appointment_id}-review`,
			group: `turno-${claim.appointment_id}`,
			actions: [
				{ action: 'google-review', title: prepared.notification_action_label }
			]
		});
		expect(payload.url).toMatch(/^\/r\/[A-Za-z0-9_-]{43}$/);
		expect(vi.mocked(webpush.generateRequestDetails).mock.calls[0][2]).toMatchObject({
			TTL: 24 * 60 * 60,
			topic: pushTopicForAppointment(claim.appointment_id, 'review')
		});

		const prepareCall = rpcCalls.find(
			(call) => call.name === 'prepare_google_review_request_delivery'
		);
		expect(prepareCall?.args?.target_click_token_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(inserts)).not.toContain(payload.url.slice('/r/'.length));
		expect(rpcCalls).toContainEqual({
			name: 'complete_google_review_request',
			args: {
				target_request_id: claim.request_id,
				target_claim_token: claim.claim_token,
				target_push_delivery_id: '70000000-0000-4000-8000-000000000007',
				target_push_service_status: 201,
				complete_time: now.toISOString()
			}
		});
		// The audit goes through the job's own client, inside its budget.
		expect(mocks.insertAuditLog).toHaveBeenCalledOnce();
		expect(mocks.insertAuditLog.mock.calls[0][0]).toBe(supabase);
	});

	it('recupera reclamaciones vencidas y reclama sólo lo que cabe en el presupuesto', async () => {
		const { supabase, rpcCalls } = createSupabase();
		await run(supabase, pushService());

		expect(rpcCalls[0]).toEqual({ name: 'recover_expired_google_review_request_claims', args: { recover_time: now.toISOString() } });
		// Free: 39 calls after the Service Binding, two fixed, eight per request in its worst case.
		expect(rpcCalls[1]).toEqual({ name: 'claim_google_review_request_batch', args: { claim_now: now.toISOString(), claim_limit: 4 } });
	});

	it('no empieza una solicitud cuyo peor caso ya no entra en el tiempo de la ejecución', async () => {
		let clock = 0;
		const budget = createJobBudget('free', () => clock);
		const second = { ...claim, request_id: '10000000-0000-4000-8000-0000000000aa' };
		const { supabase, rpcCalls } = createSupabase({ claimed: [claim, second] });
		const service = pushService(() => {
			clock = WORK_DEADLINE_MS;
			return new Response(null, { status: 201 });
		});

		const result = await run(supabase, service, budget);

		expect(result).toMatchObject({ claimed: 2, sent: 1 });
		expect(service.requests).toHaveLength(1);
		expect(rpcCalls.filter((call) => call.name === 'prepare_google_review_request_delivery')).toHaveLength(1);
	});

	it('no envía si una reprogramación invalida el claim durante la preparación', async () => {
		const { supabase } = createSupabase({ liveStatus: 'superseded' });
		const service = pushService();
		const result = await run(supabase, service);

		expect(result).toMatchObject({ sent: 0, failed: 0, invalidated: 1 });
		expect(service.requests).toHaveLength(0);
	});

	it('un fallo transitorio libera para reintentar sin matar el dispositivo', async () => {
		const { supabase, rpcCalls } = createSupabase();
		const service = pushService(() => {
			throw new TypeError('fetch failed');
		});
		const result = await run(supabase, service);

		expect(result).toMatchObject({ sent: 0, failed: 1, deadEndpoints: 0 });
		expect(rpcCalls.some((call) => call.name === 'release_google_review_request')).toBe(true);
		expect(rpcCalls.some((call) => call.name === 'mark_push_device_gone')).toBe(false);
	});

	it('un 410 marca sólo el dispositivo y libera la solicitud', async () => {
		const { supabase, rpcCalls } = createSupabase();
		const result = await run(supabase, pushService(() => new Response(null, { status: 410 })));

		expect(result).toMatchObject({ sent: 0, failed: 1, deadEndpoints: 1 });
		expect(rpcCalls).toContainEqual({
			name: 'mark_push_device_gone',
			args: { target_endpoint: claim.endpoint, gone_time: now.toISOString() }
		});
		expect(rpcCalls.some((call) => call.name === 'release_google_review_request')).toBe(true);
	});

	it('reconcilia una entrega ya aceptada sin volver a enviarla', async () => {
		const { supabase, rpcCalls, inserts } = createSupabase({
			acceptedDelivery: {
				id: '80000000-0000-4000-8000-000000000008',
				push_service_status: 201,
				accepted_at: now.toISOString(),
				failed_at: null,
				superseded_at: null
			}
		});
		const service = pushService();
		const result = await run(supabase, service);

		expect(result).toMatchObject({ sent: 1, failed: 0 });
		expect(service.requests).toHaveLength(0);
		expect(inserts).toHaveLength(0);
		expect(rpcCalls).toContainEqual({
			name: 'complete_google_review_request',
			args: {
				target_request_id: claim.request_id,
				target_claim_token: claim.claim_token,
				target_push_delivery_id: '80000000-0000-4000-8000-000000000008',
				target_push_service_status: 201,
				complete_time: now.toISOString()
			}
		});
	});

	it('si falla el cierre después de la aceptación no libera ni duplica la solicitud', async () => {
		const { supabase, rpcCalls } = createSupabase({ complete: false });
		const service = pushService();
		const result = await run(supabase, service);

		expect(result).toMatchObject({ sent: 0, failed: 1 });
		expect(service.requests).toHaveLength(1);
		expect(rpcCalls.some((call) => call.name === 'release_google_review_request')).toBe(false);
	});

	it('un intento previo de resultado incierto espera la recuperación sin reenviar ni liberar', async () => {
		const { supabase, rpcCalls } = createSupabase({
			acceptedDelivery: {
				id: '90000000-0000-4000-8000-000000000009',
				push_service_status: null,
				accepted_at: null,
				failed_at: null,
				superseded_at: null
			},
			trackingInsertError: {
				code: '23505',
				message: 'push_delivery_attempts_live_review_request_uq'
			}
		});
		const service = pushService();
		const result = await run(supabase, service);

		expect(result).toMatchObject({ sent: 0, failed: 1 });
		expect(service.requests).toHaveLength(0);
		expect(rpcCalls.some((call) => call.name === 'release_google_review_request')).toBe(false);
	});
});

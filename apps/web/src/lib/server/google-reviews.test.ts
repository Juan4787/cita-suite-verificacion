import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {
		VAPID_PUBLIC_KEY: 'test-public-key',
		VAPID_PRIVATE_KEY: 'test-private-key',
		VAPID_SUBJECT: 'mailto:test@example.com'
	} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>
}));
const mocks = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));
vi.mock('web-push', () => ({
	default: {
		setVapidDetails: vi.fn(),
		sendNotification: vi.fn()
	}
}));
vi.mock('./audit', () => ({ writeAuditLog: mocks.writeAuditLog }));

import webpush from 'web-push';
import { sendDueGoogleReviewRequests } from './google-reviews';
import { pushTopicForAppointment } from './push';

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
} = {}) => {
	const rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
	const inserts: Array<Record<string, unknown>> = [];
	const updates: Array<Record<string, unknown>> = [];

	const rpcResult = (name: string) => {
		if (name === 'claim_due_google_review_requests') return { data: [claim], error: null };
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
				maybeSingle: async () => result,
				single: async () => result,
				then: (resolve: (value: typeof result) => unknown) =>
					Promise.resolve(result).then(resolve)
			};
			return chain;
		}
	} as any;

	return { supabase, rpcCalls, inserts, updates };
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201 } as any);
});

describe('sendDueGoogleReviewRequests', () => {
	it('envía el mensaje editable, registra una sola entrega y completa el cooldown', async () => {
		const { supabase, rpcCalls, inserts } = createSupabase();
		const result = await sendDueGoogleReviewRequests(supabase, { now, limit: 7 });

		expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0, invalidated: 0 });
		expect(webpush.sendNotification).toHaveBeenCalledOnce();
		const [, rawPayload, options] = vi.mocked(webpush.sendNotification).mock.calls[0];
		const payload = JSON.parse(String(rawPayload));
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
		expect(options).toMatchObject({
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
		expect(mocks.writeAuditLog).toHaveBeenCalledOnce();
	});

	it('no envía si una reprogramación invalida el claim durante la preparación', async () => {
		const { supabase } = createSupabase({ liveStatus: 'superseded' });
		const result = await sendDueGoogleReviewRequests(supabase, { now });

		expect(result).toMatchObject({ sent: 0, failed: 0, invalidated: 1 });
		expect(webpush.sendNotification).not.toHaveBeenCalled();
	});

	it('un fallo transitorio libera para reintentar sin matar el dispositivo', async () => {
		vi.mocked(webpush.sendNotification).mockRejectedValue(new Error('timeout'));
		const { supabase, rpcCalls } = createSupabase();
		const result = await sendDueGoogleReviewRequests(supabase, { now });

		expect(result).toMatchObject({ sent: 0, failed: 1, deadEndpoints: 0 });
		expect(rpcCalls.some((call) => call.name === 'release_google_review_request')).toBe(true);
		expect(rpcCalls.some((call) => call.name === 'mark_push_device_gone')).toBe(false);
	});

	it('un 410 marca sólo el dispositivo y libera la solicitud', async () => {
		vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 410 });
		const { supabase, rpcCalls } = createSupabase();
		const result = await sendDueGoogleReviewRequests(supabase, { now });

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
		const result = await sendDueGoogleReviewRequests(supabase, { now });

		expect(result).toMatchObject({ sent: 1, failed: 0 });
		expect(webpush.sendNotification).not.toHaveBeenCalled();
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
		const result = await sendDueGoogleReviewRequests(supabase, { now });

		expect(result).toMatchObject({ sent: 0, failed: 1 });
		expect(webpush.sendNotification).toHaveBeenCalledOnce();
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
		const result = await sendDueGoogleReviewRequests(supabase, { now });

		expect(result).toMatchObject({ sent: 0, failed: 1 });
		expect(webpush.sendNotification).not.toHaveBeenCalled();
		expect(rpcCalls.some((call) => call.name === 'release_google_review_request')).toBe(false);
	});
});

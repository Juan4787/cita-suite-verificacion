import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>
}));

// The real encryption is covered by web-push-sender.test.ts. Here the request carries
// the plain payload so each test can read what the patient would receive.
vi.mock('web-push', () => ({
	default: {
		getVapidHeaders: vi.fn((audience: string) => ({ Authorization: `vapid t=jwt-for-${audience}, k=test-public-key` })),
		generateRequestDetails: vi.fn(
			(
				subscription: { endpoint: string },
				payload: string,
				options: { TTL: number; urgency: string; topic: string; headers: Record<string, string> }
			) => ({
				method: 'POST',
				endpoint: subscription.endpoint,
				headers: {
					TTL: options.TTL,
					Urgency: options.urgency,
					Topic: options.topic,
					'Content-Length': payload.length,
					...options.headers
				},
				body: Buffer.from(payload)
			})
		)
	}
}));
vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));

import webpush from 'web-push';
import { InvalidDataContractError } from '$lib/contracts/json';
import {
	JobBudgetExhaustedError,
	WORK_DEADLINE_MS,
	createJobBudget
} from '$lib/server/integrations/internal/job-budget';
import {
	getPushDeliveryStatus,
	isValidPushDeliveryId,
	isValidPushTestRequestKey,
	isValidSubscriptionPayload,
	pushTopicForAppointment,
	pushTtlUntilAppointment,
	recordPushDeliveryReceipt,
	recordPushTestFeedback,
	resetPushRemindersForReschedule,
	saveAppointmentPushSubscription,
	sendPushReminderBatch,
	sendReschedulePushNotice,
	sendTestPushNotification
} from '$lib/server/integrations/public/push';

const now = new Date('2026-06-11T12:00:00.000Z');
const subscriptionKey = crypto.createECDH('prime256v1');
subscriptionKey.generateKeys();
const validSubscriptionKeys = {
	p256dh: subscriptionKey.getPublicKey().toString('base64url'),
	auth: crypto.randomBytes(16).toString('base64url')
};

// Mock de supabase con cola de resultados por tabla: cada from(tabla) consume el
// siguiente resultado programado; update/upsert capturan el payload.
type Queued = { data?: unknown; error?: unknown; count?: number };
const createSupabaseMock = (queues: Record<string, Queued[]>, rpcResult: Queued) => {
	const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
	const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
	const upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
	const filters: Array<{ table: string; method: string; args: unknown[] }> = [];
	const rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
	const consume = (table: string): Queued => queues[table]?.shift() ?? { data: null, error: null };
	const makeChain = (table: string) => {
		const result = consume(table);
		const chain: any = {};
		for (const method of ['select', 'eq', 'is', 'not', 'in', 'gte', 'lt', 'order', 'limit']) {
			chain[method] = (...args: unknown[]) => {
				filters.push({ table, method, args });
				return chain;
			};
		}
		chain.update = (payload: Record<string, unknown>) => {
			updates.push({ table, payload });
			return chain;
		};
		chain.insert = (payload: Record<string, unknown>) => {
			inserts.push({ table, payload });
			return chain;
		};
		chain.upsert = (payload: Record<string, unknown>) => {
			upserts.push({ table, payload });
			return chain;
		};
		chain.delete = () => chain;
		chain.retry = () => chain;
		chain.maybeSingle = () => chain;
		chain.single = () => chain;
		chain.then = (resolve: (value: Queued) => unknown) => Promise.resolve(result).then(resolve);
		return chain;
	};
	return {
		supabase: {
			from: (table: string) => makeChain(table),
			rpc: (name: string, args?: Record<string, unknown>) => {
				rpcCalls.push({ name, args });
				return {
					single: async () => rpcResult,
					maybeSingle: async () => rpcResult,
					then: (resolve: (value: Queued) => unknown) =>
						Promise.resolve(rpcResult).then(resolve)
				};
			}
		} as any,
		updates,
		inserts,
		upserts,
		filters,
		rpcCalls
	};
};

// Push service double: records each request and answers with the given status.
const pushService = (answer: (request: Request) => Response | Promise<Response> = () => new Response(null, { status: 201 })) => {
	const requests: Request[] = [];
	const fetchFn: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		return answer(request);
	};
	return { fetchFn, requests };
};
const payloadOf = async (request: Request) => JSON.parse(await request.text());

const liveAppointment = {
	public_reminder_description_snapshot: 'Descripción pública sintética',
	patient_instructions_snapshot: 'Indicación clínica privada',
	note: 'Nota interna privada',
	id: 'apt-1',
	status: 'confirmed',
	starts_at: '2026-06-12T11:00:00.000Z',
	confirmation_token: 'tok-1',
	businesses: { name: 'Clínica Sabrina', timezone: 'America/Argentina/Cordoba' }
};

beforeEach(() => {
	vi.mocked(webpush.getVapidHeaders).mockClear();
	vi.mocked(webpush.generateRequestDetails).mockClear();
	envState.privateEnv.VAPID_PUBLIC_KEY = 'test-public-key';
	envState.privateEnv.VAPID_PRIVATE_KEY = 'test-private-key';
	envState.privateEnv.VAPID_SUBJECT = 'mailto:test@example.com';
});

describe('isValidSubscriptionPayload', () => {
	it('acepta una suscripción válida', () => {
		expect(
			isValidSubscriptionPayload({
				endpoint: 'https://fcm.googleapis.com/ep',
				keys: validSubscriptionKeys
			})
		).toBe(true);
	});

	it('rechaza endpoints no https y claves faltantes', () => {
		expect(
			isValidSubscriptionPayload({ endpoint: 'http://x', keys: validSubscriptionKeys })
		).toBe(false);
		expect(
			isValidSubscriptionPayload({
				endpoint: 'https://example.com/ep',
				keys: { ...validSubscriptionKeys, p256dh: '' }
			})
		).toBe(false);
		expect(isValidSubscriptionPayload(null)).toBe(false);
		expect(isValidSubscriptionPayload({})).toBe(false);
	});

	it('rechaza valores sobredimensionados', () => {
		expect(
			isValidSubscriptionPayload({
				endpoint: `https://fcm.googleapis.com/${'x'.repeat(2048)}`,
				keys: validSubscriptionKeys
			})
		).toBe(false);
		expect(
			isValidSubscriptionPayload({
				endpoint: 'https://fcm.googleapis.com/ep',
				keys: { p256dh: 'x'.repeat(513), auth: 'b' }
			})
		).toBe(false);
	});

	it('rechaza destinos locales y claves que no tienen la forma de Push API', () => {
		expect(
			isValidSubscriptionPayload({
				endpoint: 'https://127.0.0.1/push',
				keys: validSubscriptionKeys
			})
		).toBe(false);
		expect(
			isValidSubscriptionPayload({
				endpoint: 'https://example.com/ep',
				keys: { p256dh: 'a', auth: 'b' }
			})
		).toBe(false);
	});

	it('acepta sólo hosts conocidos de Web Push y rechaza hosts HTTPS arbitrarios', () => {
		for (const endpoint of [
			'https://fcm.googleapis.com/fcm/send/demo',
			'https://updates.push.services.mozilla.com/wpush/v2/demo',
			'https://web.push.apple.com/QwErTy',
			'https://abc.notify.windows.com/wpush/v1/demo',
			'https://abc.wns.windows.com/wpush/v1/demo'
		]) {
			expect(isValidSubscriptionPayload({ endpoint, keys: validSubscriptionKeys }), endpoint).toBe(true);
		}
		expect(
			isValidSubscriptionPayload({ endpoint: 'https://example.com/push', keys: validSubscriptionKeys })
		).toBe(false);
		expect(
			isValidSubscriptionPayload({ endpoint: 'https://fcm.googleapis.com.evil.example/push', keys: validSubscriptionKeys })
		).toBe(false);
	});
});

describe('identificadores y vencimiento de push', () => {
	it('valida UUID y genera topics estables, distintos para prueba y recordatorio', () => {
		expect(isValidPushDeliveryId('8ccf23d7-5ae3-4b87-9268-d40a05d9a475')).toBe(true);
		expect(isValidPushDeliveryId('apt-1')).toBe(false);

		const reminder = pushTopicForAppointment('apt-1');
		const sameReminder = pushTopicForAppointment('apt-1');
		const test = pushTopicForAppointment('apt-1', 'test');
		expect(reminder).toBe(sameReminder);
		expect(reminder).not.toBe(test);
		expect(reminder).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(test).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(isValidPushTestRequestKey('push:session-1234567890:initial')).toBe(true);
		expect(isValidPushTestRequestKey('corta')).toBe(false);
		expect(isValidPushTestRequestKey('push:clave con espacios:initial')).toBe(false);
	});

	it('nunca mantiene un push en cola más allá del turno ni del máximo del kind', () => {
		expect(pushTtlUntilAppointment(new Date(now.getTime() + 30 * 60_000), now, 7200)).toBe(
			1800
		);
		expect(pushTtlUntilAppointment(new Date(now.getTime() + 30 * 60_000), now, 300)).toBe(
			300
		);
		expect(pushTtlUntilAppointment(new Date(now.getTime() + 30_000), now, 7200)).toBe(30);
		expect(pushTtlUntilAppointment(new Date(now.getTime() - 1), now, 7200)).toBe(0);
	});
});

describe('persistencia de la suscripción', () => {
	const appointment = {
		id: 'apt-1',
		business: { id: 'biz-1' }
	} as any;
	const payload = {
		endpoint: 'https://push.example/ep',
		keys: validSubscriptionKeys
	};

	it('conserva la verificación al recargar la misma suscripción sana', async () => {
		const verifiedAt = '2026-06-11T11:00:00.000Z';
		const { supabase, rpcCalls } = createSupabaseMock({}, {
			data: {
				subscription_id: 'sub-1',
				endpoint: payload.endpoint,
				verification_confirmed_at: verifiedAt,
				provider_gone: false
			},
			error: null
		});

		const saved = await saveAppointmentPushSubscription(supabase, appointment, payload, 'Android');
		expect(rpcCalls[0]).toMatchObject({
			name: 'save_appointment_push_subscription',
			args: {
				target_business_id: 'biz-1',
				target_appointment_id: 'apt-1',
				target_endpoint: payload.endpoint,
				target_p256dh: payload.keys.p256dh,
				target_auth: payload.keys.auth,
				target_user_agent: 'Android'
			}
		});
		expect(saved.verifiedAt).toBe(verifiedAt);
	});

	it('devuelve una comprobación pendiente sin marcar muerto el dispositivo', async () => {
		const { supabase } = createSupabaseMock({}, {
			data: {
				subscription_id: 'sub-1',
				endpoint: payload.endpoint,
				verification_confirmed_at: null,
				provider_gone: false
			},
			error: null
		});

		const saved = await saveAppointmentPushSubscription(
			supabase,
			appointment,
			payload,
			'Android'
		);
		expect(saved).toMatchObject({ verifiedAt: null, providerGone: false });
	});

	it('reutiliza la confirmación del mismo dispositivo al asociarlo con otro turno', async () => {
		const newAppointment = {
			id: 'apt-2',
			business: { id: 'biz-1' }
		} as any;
		const verifiedAt = '2026-06-11T11:00:00.000Z';
		const { supabase, rpcCalls } = createSupabaseMock({}, {
			data: {
				subscription_id: 'sub-2',
				endpoint: payload.endpoint,
				verification_confirmed_at: verifiedAt,
				provider_gone: false
			},
			error: null
		});

		const saved = await saveAppointmentPushSubscription(
			supabase,
			newAppointment,
			payload,
			'Android'
		);

		expect(rpcCalls[0].args?.target_appointment_id).toBe('apt-2');
		expect(saved).toMatchObject({ id: 'sub-2', verifiedAt, providerGone: false });
	});

	it('conserva como muerto solamente un endpoint rechazado explícitamente por el proveedor', async () => {
		const { supabase } = createSupabaseMock({}, {
			data: {
				subscription_id: 'sub-1',
				endpoint: payload.endpoint,
				verification_confirmed_at: null,
				provider_gone: true
			},
			error: null
		});

		await expect(
			saveAppointmentPushSubscription(supabase, appointment, payload, 'Android')
		).resolves.toMatchObject({ providerGone: true, verifiedAt: null });
	});
});

describe('telemetría de entrega', () => {
	const deliveryId = '8ccf23d7-5ae3-4b87-9268-d40a05d9a475';
	const receiptToken = 'a'.repeat(43);
	const receiptHash = crypto.createHash('sha256').update(receiptToken).digest('hex');

	it('registra recibido/mostrado sólo con el secreto correcto', async () => {
		const { supabase, updates } = createSupabaseMock(
			{
				push_delivery_attempts: [
					{
						data: {
							id: deliveryId,
							receipt_token_hash: receiptHash,
							received_at: null,
							displayed_at: null
						},
						error: null
					},
					{ data: { id: deliveryId }, error: null }
				]
			},
			{ data: null, error: null }
		);

		const recorded = await recordPushDeliveryReceipt(supabase, {
			appointmentId: 'apt-1',
			deliveryId,
			receiptToken,
			stage: 'displayed',
			now
		});
		expect(recorded).toBe(true);
		expect(updates[0]).toMatchObject({
			table: 'push_delivery_attempts',
			payload: {
				received_at: now.toISOString(),
				displayed_at: now.toISOString()
			}
		});
	});

	it('no modifica nada ante un secreto inválido', async () => {
		const { supabase, updates } = createSupabaseMock(
			{
				push_delivery_attempts: [
					{
						data: {
							id: deliveryId,
							receipt_token_hash: receiptHash,
							received_at: null,
							displayed_at: null
						},
						error: null
					}
				]
			},
			{ data: null, error: null }
		);

		expect(
			await recordPushDeliveryReceipt(supabase, {
				appointmentId: 'apt-1',
				deliveryId,
				receiptToken: 'b'.repeat(43),
				stage: 'received',
				now
			})
		).toBe(false);
		expect(updates).toEqual([]);
	});

	it('registra el clic mediante la operación atómica y autenticada', async () => {
		const { supabase, rpcCalls, updates } = createSupabaseMock({}, { data: true, error: null });

		expect(
			await recordPushDeliveryReceipt(supabase, {
				appointmentId: 'apt-1',
				deliveryId,
				receiptToken,
				stage: 'clicked',
				now
			})
		).toBe(true);
		expect(rpcCalls).toEqual([
			{
				name: 'record_push_notification_click',
				args: {
					target_appointment_id: 'apt-1',
					target_delivery_id: deliveryId,
					target_receipt_token_hash: receiptHash,
					click_time: now.toISOString()
				}
			}
		]);
		// El servidor no intenta reproducir en dos escrituras lo que la base resuelve
		// de forma transaccional.
		expect(updates).toEqual([]);
	});

	it('presenta el clic como interacción confirmada, distinta de displayed', async () => {
		const { supabase } = createSupabaseMock(
			{
				push_delivery_attempts: [
					{
						data: {
							id: deliveryId,
							kind: 'test',
							accepted_at: now.toISOString(),
							received_at: now.toISOString(),
							displayed_at: now.toISOString(),
							clicked_at: now.toISOString(),
							user_confirmed_at: null,
							user_reported_missing_at: null,
							superseded_at: null,
							failed_at: null,
							expires_at: new Date(now.getTime() + 60_000).toISOString(),
							created_at: now.toISOString()
						},
						error: null
					}
				]
			},
			{ data: null, error: null }
		);

		await expect(
			getPushDeliveryStatus(supabase, {
				appointmentId: 'apt-1',
				deliveryId,
				now
			})
		).resolves.toMatchObject({ state: 'clicked' });
	});

	it('prioriza el estado obsoleto después de una reprogramación', async () => {
		const { supabase } = createSupabaseMock(
			{
				push_delivery_attempts: [
					{
						data: {
							id: deliveryId,
							kind: '24h',
							accepted_at: now.toISOString(),
							received_at: now.toISOString(),
							displayed_at: now.toISOString(),
							user_confirmed_at: null,
							user_reported_missing_at: null,
							superseded_at: now.toISOString(),
							failed_at: null,
							expires_at: new Date(now.getTime() + 60_000).toISOString(),
							created_at: now.toISOString()
						},
						error: null
					}
				]
			},
			{ data: null, error: null }
		);
		const status = await getPushDeliveryStatus(supabase, {
			appointmentId: 'apt-1',
			deliveryId,
			now
		});
		expect(status?.state).toBe('superseded');
	});

	it('guarda la confirmación explícita de la persona', async () => {
		const { supabase, rpcCalls, updates } = createSupabaseMock({}, { data: true, error: null });
		expect(
			await recordPushTestFeedback(supabase, {
				appointmentId: 'apt-1',
				deliveryId,
				visible: true,
				now
			})
		).toBe(true);
		expect(rpcCalls).toEqual([
			{
				name: 'record_push_test_feedback',
				args: {
					target_appointment_id: 'apt-1',
					target_delivery_id: deliveryId,
					feedback_visible: true,
					feedback_time: now.toISOString()
				}
			}
		]);
		expect(updates).toEqual([]);
	});

	it('quita la verificación sin revocar el endpoint cuando la persona informa que no llegó', async () => {
		const { supabase, rpcCalls, updates } = createSupabaseMock({}, { data: true, error: null });

		expect(
			await recordPushTestFeedback(supabase, {
				appointmentId: 'apt-1',
				deliveryId,
				visible: false,
				now
			})
		).toBe(true);
		expect(rpcCalls[0]).toEqual({
			name: 'record_push_test_feedback',
			args: {
				target_appointment_id: 'apt-1',
				target_delivery_id: deliveryId,
				feedback_visible: false,
				feedback_time: now.toISOString()
			}
		});
		expect(updates).toEqual([]);
	});
});

describe('sendTestPushNotification', () => {
	const appointment = {
		id: 'apt-1',
		token: 'tok-1',
		business: { id: 'biz-1', name: 'Clínica Sabrina' }
	} as any;
	const subscription = {
		id: 'sub-1',
		endpoint: 'https://push.example/ep-1',
		p256dh: 'p256dh-key',
		auth: 'auth-key'
	};

	it('envía una prueba rastreable sin guardar el secreto de recibo en claro', async () => {
		const deliveryId = '8ccf23d7-5ae3-4b87-9268-d40a05d9a475';
		const { supabase, inserts } = createSupabaseMock(
			{
				push_delivery_attempts: [
					{ data: null, error: null },
					{ data: { id: deliveryId }, error: null },
					{ data: null, error: null }
				]
			},
			{ data: null, error: null }
		);
		const service = pushService();

		const requestKey = 'push:session-1234567890:initial';
		const result = await sendTestPushNotification(supabase, service.fetchFn, {
			appointment,
			requestKey,
			subscription,
			now
		});

		expect(result).toMatchObject({ accepted: true, deliveryId });
		expect(service.requests).toHaveLength(1);
		expect(service.requests[0].url).toBe('https://push.example/ep-1');
		expect(vi.mocked(webpush.generateRequestDetails).mock.calls[0][2]).toMatchObject({
			TTL: 300,
			urgency: 'high',
			topic: pushTopicForAppointment('apt-1', 'test')
		});
		// fetch sets the body length itself; the VAPID header travels as computed.
		expect(service.requests[0].headers.get('content-length')).toBeNull();
		expect(service.requests[0].headers.get('authorization')).toBe('vapid t=jwt-for-https://push.example, k=test-public-key');
		const payload = await payloadOf(service.requests[0]);
		expect(payload.delivery.id).toBe(deliveryId);
		expect(payload.delivery.receiptUrl).toContain('/turno/tok-1/push/receipt');
		expect(inserts[0].payload.receipt_token_hash).toBe(
			crypto.createHash('sha256').update(payload.delivery.token).digest('hex')
		);
		expect(inserts[0].payload.receipt_token_hash).not.toBe(payload.delivery.token);
		expect(inserts[0].payload.request_key_hash).toBe(
			crypto.createHash('sha256').update(requestKey).digest('hex')
		);
	});

	it('recupera la misma prueba ante una clave repetida y no vuelve a enviarla', async () => {
		const deliveryId = '8ccf23d7-5ae3-4b87-9268-d40a05d9a475';
		const { supabase } = createSupabaseMock(
			{
				push_delivery_attempts: [
					{ data: null, error: null },
					{ data: null, error: { code: '23505' } },
					{ data: { id: deliveryId, push_service_status: 201 }, error: null }
				]
			},
			{ data: null, error: null }
		);
		const service = pushService();

		const result = await sendTestPushNotification(supabase, service.fetchFn, {
			appointment,
			requestKey: 'push:session-1234567890:recovery',
			subscription,
			now
		});

		expect(result).toMatchObject({ accepted: true, deliveryId });
		expect(service.requests).toHaveLength(0);
	});

	it('reutiliza una prueba reciente aunque otra pestaña llegue con otra clave', async () => {
		const deliveryId = '8ccf23d7-5ae3-4b87-9268-d40a05d9a475';
		const { supabase, inserts } = createSupabaseMock(
			{
				push_delivery_attempts: [
					{
						data: {
							id: deliveryId,
							kind: 'test',
							accepted_at: now.toISOString(),
							received_at: null,
							displayed_at: null,
							user_confirmed_at: null,
							user_reported_missing_at: null,
							superseded_at: null,
							failed_at: null,
							expires_at: new Date(now.getTime() + 60_000).toISOString(),
							created_at: new Date(now.getTime() - 2_000).toISOString()
						},
						error: null
					}
				]
			},
			{ data: null, error: null }
		);
		const service = pushService();

		const result = await sendTestPushNotification(supabase, service.fetchFn, {
			appointment,
			requestKey: 'push:other-tab-1234567890:initial',
			subscription,
			now
		});

		expect(result).toMatchObject({ accepted: true, deliveryId });
		expect(inserts).toHaveLength(0);
		expect(service.requests).toHaveLength(0);
	});

	it('no presenta como aceptada una prueba idempotente que ya había fallado', async () => {
		const deliveryId = '8ccf23d7-5ae3-4b87-9268-d40a05d9a475';
		const { supabase } = createSupabaseMock(
			{
				push_delivery_attempts: [
					{ data: null, error: null },
					{ data: null, error: { code: '23505' } },
					{
						data: {
							id: deliveryId,
							push_service_status: 503,
							failed_at: now.toISOString(),
							failure_kind: 'transient'
						},
						error: null
					}
				]
			},
			{ data: null, error: null }
		);
		const service = pushService();

		const result = await sendTestPushNotification(supabase, service.fetchFn, {
			appointment,
			requestKey: 'push:session-1234567890:initial',
			subscription,
			now
		});

		expect(result).toMatchObject({ accepted: false, deliveryId, gone: false });
		expect(service.requests).toHaveLength(0);
	});

	it('marca muerto el dispositivo que el proveedor rechaza con 410', async () => {
		const { supabase, rpcCalls } = createSupabaseMock(
			{
				push_delivery_attempts: [
					{ data: null, error: null },
					{ data: { id: '8ccf23d7-5ae3-4b87-9268-d40a05d9a475' }, error: null },
					{ data: null, error: null }
				]
			},
			{ data: null, error: null }
		);
		const service = pushService(() => new Response(null, { status: 410 }));

		const result = await sendTestPushNotification(supabase, service.fetchFn, { appointment, subscription, now });

		expect(result).toMatchObject({ accepted: false, gone: true });
		expect(rpcCalls).toContainEqual({
			name: 'mark_push_device_gone',
			args: { target_endpoint: subscription.endpoint, gone_time: now.toISOString() }
		});
	});
});

describe('sendPushReminderBatch', () => {
	const prepared = (index: number, overrides: Record<string, unknown> = {}) => ({
		subscription_id: `sub-${index}`,
		kind: '24h',
		business_id: 'biz-1',
		appointment_id: `apt-${index}`,
		delivery_id: `delivery-${index}`,
		endpoint: `https://push.example/ep-${index}`,
		p256dh: 'p256dh-key',
		auth: 'auth-key',
		ttl_seconds: 23 * 60 * 60,
		starts_at: '2026-06-12T11:00:00.000Z',
		confirmation_token: `tok-${index}`,
		reminder_description: 'Descripción pública sintética',
		business_name: 'Clínica Sabrina',
		business_timezone: 'America/Argentina/Cordoba',
		...overrides
	});
	const advanced = (items: unknown[], extra: Record<string, unknown> = {}) => ({
		completed: 0,
		released: 0,
		prepared: items,
		invalidated: [],
		...extra
	});
	const batchDatabase = (claimed: unknown[], advances: unknown[]) => {
		const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
		const supabase = {
			rpc: async (name: string, args: Record<string, unknown>) => {
				calls.push({ name, args });
				if (name === 'claim_push_reminder_batch') return { data: claimed, error: null };
				if (name === 'advance_push_reminder_batch') return { data: advances.shift() ?? advanced([]), error: null };
				return { data: null, error: { message: `unexpected ${name}` } };
			}
		} as any;
		return { supabase, calls, advances: () => calls.filter((call) => call.name === 'advance_push_reminder_batch') };
	};
	const claimed = (count: number) =>
		Array.from({ length: count }, (_, index) => ({
			subscription_id: `sub-${index + 1}`,
			reminder_kind: '24h',
			business_id: 'biz-1',
			business_turn: index + 1
		}));

	it('reclama según el presupuesto, envía de a cuatro y registra cada tramo en el viaje siguiente', async () => {
		const database = batchDatabase(claimed(6), [
			advanced([1, 2, 3, 4].map((index) => prepared(index))),
			advanced([5, 6].map((index) => prepared(index))),
			advanced([], { completed: 2 })
		]);
		const service = pushService();
		const budget = createJobBudget('free');

		const summary = await sendPushReminderBatch({
			supabase: database.supabase,
			budget,
			providerFetch: budget.fetchFor('provider', service.fetchFn),
			now
		});

		expect(summary).toEqual({ configured: true, claimed: 6, sent: 6, failed: 0, gone: 0, invalidated: 0, released: 0 });
		// Free: 39 calls after the Service Binding, two fixed, five per chunk of four.
		expect(database.calls[0]).toMatchObject({ name: 'claim_push_reminder_batch', args: { p_limit: 28, p_now: now.toISOString() } });
		const [first, second, last] = database.advances();
		expect(first.args).toMatchObject({ p_results: [], p_finish: false });
		expect(second.args.p_results).toEqual(
			[1, 2, 3, 4].map((index) => ({ subscription_id: `sub-${index}`, kind: '24h', delivery_id: `delivery-${index}`, outcome: 'accepted', status_code: 201 }))
		);
		expect(last.args).toMatchObject({ p_next: [], p_finish: true });
		expect(last.args.p_results).toHaveLength(2);
		expect(database.advances()).toHaveLength(3);
		expect(new Set(database.advances().map((call) => call.args.p_claim_token)).size).toBe(1);
		expect(service.requests).toHaveLength(6);
		expect(budget.summary()).toMatchObject({ providerRequests: 6 });
		// One VAPID signature for the push service origin, not one per message.
		expect(webpush.getVapidHeaders).toHaveBeenCalledTimes(1);
	});

	it('con el perfil Paid reclama el máximo que admite la base', async () => {
		const database = batchDatabase([], []);
		await sendPushReminderBatch({ supabase: database.supabase, budget: createJobBudget('paid'), providerFetch: fetch, now });
		expect(database.calls[0]).toMatchObject({ name: 'claim_push_reminder_batch', args: { p_limit: 100 } });
	});

	it('envía el contenido neutral del turno y un recibo que corresponde al intento registrado', async () => {
		const database = batchDatabase(claimed(1), [advanced([prepared(1)])]);
		const service = pushService();

		await sendPushReminderBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now });

		const payload = await payloadOf(service.requests[0]);
		expect(payload).toMatchObject({
			title: 'Turno en Clínica Sabrina',
			url: '/turno/tok-1',
			tag: 'turno-apt-1-24h',
			group: 'turno-apt-1',
			delivery: { id: 'delivery-1', receiptUrl: '/turno/tok-1/push/receipt' }
		});
		expect(payload.body).toContain('a las 08:00');
		expect(payload.body).toContain('Descripción pública sintética');
		const hash = crypto.createHash('sha256').update(payload.delivery.token).digest('hex');
		expect(database.advances()[0].args.p_next).toEqual([{ subscription_id: 'sub-1', kind: '24h', receipt_token_hash: hash }]);
		expect(vi.mocked(webpush.generateRequestDetails).mock.calls[0][2]).toMatchObject({
			TTL: 23 * 60 * 60,
			urgency: 'high',
			topic: pushTopicForAppointment('apt-1'),
			contentEncoding: 'aes128gcm'
		});
	});

	it('clasifica cada respuesta del proveedor y una respuesta perdida como transitoria', async () => {
		const statuses = [410, 404, 400, 429, 503];
		const database = batchDatabase(claimed(6), [
			advanced([1, 2, 3, 4].map((index) => prepared(index))),
			advanced([5, 6].map((index) => prepared(index)))
		]);
		const service = pushService((request) => {
			const index = Number(new URL(request.url).pathname.split('-').pop());
			if (index === 6) throw new TypeError('fetch failed');
			return new Response(null, { status: statuses[index - 1] });
		});

		const summary = await sendPushReminderBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now });

		const results = [...(database.advances()[1].args.p_results as unknown[]), ...(database.advances()[2].args.p_results as unknown[])];
		expect(results).toEqual([
			{ subscription_id: 'sub-1', kind: '24h', delivery_id: 'delivery-1', outcome: 'gone', status_code: 410 },
			{ subscription_id: 'sub-2', kind: '24h', delivery_id: 'delivery-2', outcome: 'gone', status_code: 404 },
			{ subscription_id: 'sub-3', kind: '24h', delivery_id: 'delivery-3', outcome: 'rejected', status_code: 400 },
			{ subscription_id: 'sub-4', kind: '24h', delivery_id: 'delivery-4', outcome: 'transient', status_code: 429 },
			{ subscription_id: 'sub-5', kind: '24h', delivery_id: 'delivery-5', outcome: 'transient', status_code: 503 },
			{ subscription_id: 'sub-6', kind: '24h', delivery_id: 'delivery-6', outcome: 'transient', status_code: null }
		]);
		expect(summary).toMatchObject({ sent: 0, gone: 2, failed: 4 });
	});

	it('no envía lo que la base invalidó al revalidar y cuenta lo liberado al cerrar', async () => {
		const database = batchDatabase(claimed(2), [
			advanced([prepared(2)], { invalidated: [{ subscription_id: 'sub-1', kind: '24h', reason: 'revalidation_failed' }] }),
			advanced([], { completed: 1, released: 0 })
		]);
		const service = pushService();

		const summary = await sendPushReminderBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now });

		expect(service.requests.map((request) => request.url)).toEqual(['https://push.example/ep-2']);
		expect(summary).toMatchObject({ claimed: 2, sent: 1, invalidated: 1 });
	});

	it('deja de preparar trabajo cuando ya no cabe en el tiempo y libera el resto de la reclamación', async () => {
		let clock = 0;
		const budget = createJobBudget('free', () => clock);
		const database = batchDatabase(claimed(8), [
			advanced([1, 2, 3, 4].map((index) => prepared(index))),
			advanced([], { completed: 4, released: 4 })
		]);
		const service = pushService(() => {
			clock = WORK_DEADLINE_MS - 1_000;
			return new Response(null, { status: 201 });
		});

		const summary = await sendPushReminderBatch({ supabase: database.supabase, budget, providerFetch: budget.fetchFor('provider', service.fetchFn), now });

		expect(service.requests).toHaveLength(4);
		const [, last] = database.advances();
		expect(last.args).toMatchObject({ p_next: [], p_finish: true });
		expect(summary).toMatchObject({ claimed: 8, sent: 4, released: 4 });
	});

	it('excluye de los resultados un envío que la fecha límite impidió empezar', async () => {
		const database = batchDatabase(claimed(1), [advanced([prepared(1)])]);

		const summary = await sendPushReminderBatch({
			supabase: database.supabase,
			budget: createJobBudget('free'),
			providerFetch: async () => {
				throw new JobBudgetExhaustedError('time');
			},
			now
		});

		expect(database.advances()[1].args).toMatchObject({ p_results: [], p_finish: true });
		expect(summary).toMatchObject({ sent: 0, failed: 0 });
	});

	it('rechaza un recordatorio preparado que no pidió y cierra el lote antes de fallar', async () => {
		const database = batchDatabase(claimed(1), [advanced([prepared(9)])]);
		const service = pushService();

		await expect(
			sendPushReminderBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now })
		).rejects.toBeInstanceOf(InvalidDataContractError);

		expect(service.requests).toHaveLength(0);
		expect(database.advances().at(-1)?.args).toMatchObject({ p_next: [], p_finish: true });
	});

	it('sin VAPID configurado no reclama nada', async () => {
		delete envState.privateEnv.VAPID_PUBLIC_KEY;
		delete envState.privateEnv.VAPID_PRIVATE_KEY;
		delete envState.publicEnv.PUBLIC_VAPID_PUBLIC_KEY;
		const database = batchDatabase([], []);

		const summary = await sendPushReminderBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: fetch, now });

		expect(summary).toMatchObject({ configured: false, claimed: 0 });
		expect(database.calls).toHaveLength(0);
	});
});

describe('sendReschedulePushNotice', () => {
	const subscriptionRow = {
		id: 'sub-1',
		push_devices: {
			endpoint: 'https://push.example/ep-1',
			p256dh: 'p256dh-key',
			auth: 'auth-key',
			provider_gone_at: null
		}
	};

	it('envía aunque falte confirmar la prueba, sin tocar flags sent/claimed', async () => {
		const { supabase, updates, filters } = createSupabaseMock(
			{
				appointments: [{ data: liveAppointment, error: null }],
				push_subscriptions: [{ data: [subscriptionRow], error: null }],
				push_delivery_attempts: [{ data: { id: 'delivery-1' }, error: null }, { data: null, error: null }]
			},
			{ data: null, error: null }
		);
		const service = pushService();

		const result = await sendReschedulePushNotice(supabase, service.fetchFn, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			now
		});

		expect(result.sent).toBe(1);
		expect(service.requests).toHaveLength(1);
		const payload = await payloadOf(service.requests[0]);
		expect(payload.body).toContain('reprogramado');
		expect(payload.body).toContain('a las 08:00');
		expect(payload.body).toContain('Descripción pública sintética');
		expect(payload.body).not.toContain('Indicación clínica privada');
		expect(payload.body).not.toContain('Nota interna privada');
		// Mismo tag que el aviso de 24h: pisa la notificación vieja en el navegador.
		expect(payload.tag).toBe('turno-apt-1-24h');
		expect(payload.group).toBe('turno-apt-1');
		expect(payload.url).toContain('/turno/tok-1');
		expect(vi.mocked(webpush.generateRequestDetails).mock.calls[0][2]).toMatchObject({
			topic: pushTopicForAppointment('apt-1')
		});
		expect(filters).not.toContainEqual({
			table: 'push_subscriptions',
			method: 'not',
			args: ['verified_at', 'is', null]
		});
		// Los recordatorios del nuevo horario siguen su curso: no se marca nada.
		expect(
			updates.some(
				(u) =>
					'push_24h_sent_at' in u.payload ||
					'push_2h_sent_at' in u.payload ||
					'push_24h_claimed_at' in u.payload ||
					'push_2h_claimed_at' in u.payload
			)
		).toBe(false);
	});

	it('turno cancelado o pasado: no envía nada', async () => {
		const { supabase } = createSupabaseMock(
			{
				appointments: [{ data: { ...liveAppointment, status: 'cancelled' }, error: null }]
			},
			{ data: null, error: null }
		);
		const service = pushService();

		const result = await sendReschedulePushNotice(supabase, service.fetchFn, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			now
		});
		expect(result.sent).toBe(0);
		expect(service.requests).toHaveLength(0);
	});

	it('endpoint muerto (410): registra el dispositivo sin desvincular el turno', async () => {
		const { supabase, updates, rpcCalls } = createSupabaseMock(
			{
				appointments: [{ data: liveAppointment, error: null }],
				push_subscriptions: [{ data: [subscriptionRow], error: null }],
				push_delivery_attempts: [{ data: { id: 'delivery-1' }, error: null }, { data: null, error: null }]
			},
			{ data: null, error: null }
		);
		const service = pushService(() => new Response(null, { status: 410 }));

		const result = await sendReschedulePushNotice(supabase, service.fetchFn, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			now
		});
		expect(result.failed).toBe(1);
		expect(result.deadEndpoints).toBe(1);
		expect(rpcCalls.some((call) => call.name === 'mark_push_device_gone')).toBe(true);
		expect(updates.some((update) => 'detached_at' in update.payload)).toBe(false);
	});
});

describe('resetPushRemindersForReschedule', () => {
	// Mock que captura el payload del update y los filtros eq/is aplicados.
	const makeMock = (data: unknown = [{ id: 'sub-1' }]) => {
		const calls = {
			update: null as Record<string, unknown> | null,
			eq: [] as Array<[string, unknown]>,
			is: [] as Array<[string, unknown]>,
			table: ''
		};
		const chain: any = {
			update(payload: Record<string, unknown>) {
				calls.update = payload;
				return chain;
			},
			eq(col: string, val: unknown) {
				calls.eq.push([col, val]);
				return chain;
			},
			is(col: string, val: unknown) {
				calls.is.push([col, val]);
				return chain;
			},
			select: () => chain,
			then: (resolve: (v: unknown) => unknown) =>
				Promise.resolve({ data, error: null }).then(resolve)
		};
		const supabase = {
			from(table: string) {
				calls.table = table;
				return chain;
			}
		} as any;
		return { supabase, calls };
	};

	it('reinicia ambos recordatorios, su reclamación y su espera sólo en vínculos asociados', async () => {
		const { supabase, calls } = makeMock([{ id: 'sub-1' }, { id: 'sub-2' }]);
		const count = await resetPushRemindersForReschedule(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			now
		});

		expect(count).toBe(2);
		expect(calls.table).toBe('push_subscriptions');
		expect(calls.update).toEqual({
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
			updated_at: now.toISOString()
		});
		expect(calls.eq).toEqual([
			['business_id', 'biz-1'],
			['appointment_id', 'apt-1']
		]);
		expect(calls.is).toEqual([['detached_at', null]]);
	});

	it('propaga el error de Supabase', async () => {
		const chain: any = {
			update: () => chain,
			eq: () => chain,
			is: () => chain,
			select: () => chain,
			then: (resolve: (v: unknown) => unknown) =>
				Promise.resolve({ data: null, error: new Error('boom') }).then(resolve)
		};
		const supabase = { from: () => chain } as any;
		await expect(
			resetPushRemindersForReschedule(supabase, { businessId: 'b', appointmentId: 'a' })
		).rejects.toThrow('boom');
	});
});

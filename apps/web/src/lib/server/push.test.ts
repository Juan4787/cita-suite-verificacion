import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>
}));

vi.mock('web-push', () => ({
	default: {
		setVapidDetails: vi.fn(),
		sendNotification: vi.fn()
	}
}));
vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));

import webpush from 'web-push';
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
	sendDuePushReminders,
	sendReschedulePushNotice,
	sendTestPushNotification
} from './push';

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
		chain.maybeSingle = async () => result;
		chain.single = async () => result;
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

const claimedRow = {
	subscription_id: 'sub-1',
	appointment_id: 'apt-1',
	business_id: 'biz-1',
	endpoint: 'https://push.example/ep-1',
	p256dh: 'p256dh-key',
	auth: 'auth-key',
	reminder_kind: '24h'
};

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
	vi.mocked(webpush.sendNotification).mockReset();
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
	it('envía una prueba rastreable sin guardar el secreto de recibo en claro', async () => {
		const deliveryId = '8ccf23d7-5ae3-4b87-9268-d40a05d9a475';
		vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201 } as any);
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
		const appointment = {
			id: 'apt-1',
			token: 'tok-1',
			business: { id: 'biz-1', name: 'Clínica Sabrina' }
		} as any;

		const requestKey = 'push:session-1234567890:initial';
		const result = await sendTestPushNotification(supabase, {
			appointment,
			requestKey,
			subscription: {
				id: 'sub-1',
				endpoint: 'https://push.example/ep-1',
				p256dh: 'p256dh-key',
				auth: 'auth-key'
			},
			now
		});

		expect(result).toMatchObject({ accepted: true, deliveryId });
		expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
		const [, rawPayload, options] = vi.mocked(webpush.sendNotification).mock.calls[0];
		const payload = JSON.parse(rawPayload as string);
		expect(options).toMatchObject({
			TTL: 300,
			topic: pushTopicForAppointment('apt-1', 'test')
		});
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
		const appointment = {
			id: 'apt-1',
			token: 'tok-1',
			business: { id: 'biz-1', name: 'Clínica Sabrina' }
		} as any;

		const result = await sendTestPushNotification(supabase, {
			appointment,
			requestKey: 'push:session-1234567890:recovery',
			subscription: {
				id: 'sub-1',
				endpoint: 'https://push.example/ep-1',
				p256dh: 'p256dh-key',
				auth: 'auth-key'
			},
			now
		});

		expect(result).toMatchObject({ accepted: true, deliveryId });
		expect(webpush.sendNotification).not.toHaveBeenCalled();
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
		const appointment = {
			id: 'apt-1',
			token: 'tok-1',
			business: { id: 'biz-1', name: 'Clínica Sabrina' }
		} as any;

		const result = await sendTestPushNotification(supabase, {
			appointment,
			requestKey: 'push:other-tab-1234567890:initial',
			subscription: {
				id: 'sub-1',
				endpoint: 'https://push.example/ep-1',
				p256dh: 'p256dh-key',
				auth: 'auth-key'
			},
			now
		});

		expect(result).toMatchObject({ accepted: true, deliveryId });
		expect(inserts).toHaveLength(0);
		expect(webpush.sendNotification).not.toHaveBeenCalled();
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
		const appointment = {
			id: 'apt-1',
			token: 'tok-1',
			business: { id: 'biz-1', name: 'Clínica Sabrina' }
		} as any;

		const result = await sendTestPushNotification(supabase, {
			appointment,
			requestKey: 'push:session-1234567890:initial',
			subscription: {
				id: 'sub-1',
				endpoint: 'https://push.example/ep-1',
				p256dh: 'p256dh-key',
				auth: 'auth-key'
			},
			now
		});

		expect(result).toMatchObject({ accepted: false, deliveryId, gone: false });
		expect(webpush.sendNotification).not.toHaveBeenCalled();
	});
});

describe('sendDuePushReminders', () => {
	it('envía el recordatorio y recién después marca sent_at del kind correcto', async () => {
		vi.mocked(webpush.sendNotification).mockResolvedValue({} as any);
		const { supabase, updates } = createSupabaseMock(
			{
				push_subscriptions: [{ data: [] }],
				appointments: [{ data: liveAppointment, error: null }]
			},
			{ data: [claimedRow], error: null }
		);

		const result = await sendDuePushReminders(supabase, { now });
		expect(result.sent).toBe(1);
		expect(result.failed).toBe(0);

		expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
		expect(payload.title).toBe('Turno en Clínica Sabrina');
		expect(payload.body).toContain('a las 08:00');
		expect(payload.body).toContain('Descripción pública sintética');
		expect(payload.body).not.toContain('Indicación clínica privada');
		expect(payload.body).not.toContain('Nota interna privada');
		expect(payload.url).toContain('/turno/tok-1');
		expect(vi.mocked(webpush.sendNotification).mock.calls[0][2]).toMatchObject({
			topic: pushTopicForAppointment('apt-1'),
			TTL: 23 * 60 * 60
		});

		const sentUpdate = updates.find((u) => u.payload.push_24h_sent_at);
		expect(sentUpdate).toBeTruthy();
	});

	it('marca el dispositivo como muerto solamente ante 410 del push service', async () => {
		vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 410 });
		const { supabase, updates, rpcCalls } = createSupabaseMock(
			{
				push_subscriptions: [{ data: [] }, { data: null }],
				appointments: [{ data: liveAppointment, error: null }]
			},
			{ data: [claimedRow], error: null }
		);

		const result = await sendDuePushReminders(supabase, { now });
		expect(result.failed).toBe(1);
		expect(result.deadEndpoints).toBe(1);
		expect(rpcCalls).toContainEqual({
			name: 'mark_push_device_gone',
			args: { target_endpoint: claimedRow.endpoint, gone_time: now.toISOString() }
		});
		expect(updates.some((u) => u.payload.push_24h_sent_at)).toBe(false);
	});

	it('error transitorio: libera el claim e incrementa failed_count (reintenta luego)', async () => {
		vi.mocked(webpush.sendNotification).mockRejectedValue(new Error('timeout'));
		const { supabase, updates, rpcCalls } = createSupabaseMock(
			{
				push_subscriptions: [{ data: [] }, { data: { failed_count: 0 } }, { data: null }],
				appointments: [{ data: liveAppointment, error: null }]
			},
			{ data: [claimedRow], error: null }
		);

		await sendDuePushReminders(supabase, { now });
		const release = updates.find((u) => u.payload.failed_count === 1);
		expect(release).toBeTruthy();
		expect(release?.payload.push_24h_claimed_at).toBeNull();
		expect(updates.some((u) => u.payload.push_24h_sent_at)).toBe(false);
		expect(rpcCalls.some((call) => call.name === 'mark_push_device_gone')).toBe(false);
	});

	it('no envía si una reasignación desvinculó el turno antes de crear la telemetría', async () => {
		const { supabase } = createSupabaseMock(
			{
				push_delivery_attempts: [
					{ data: null, error: null },
					{ data: null, error: { message: 'PUSH_SUBSCRIPTION_DETACHED' } }
				],
				push_subscriptions: [
					{ data: [] },
					{ data: { failed_count: 0 }, error: null },
					{ data: null, error: null }
				],
				appointments: [{ data: liveAppointment, error: null }]
			},
			{ data: [claimedRow], error: null }
		);

		const result = await sendDuePushReminders(supabase, { now });
		expect(result).toMatchObject({ sent: 0, failed: 1 });
		expect(webpush.sendNotification).not.toHaveBeenCalled();
	});

	it('turno cancelado tras el claim: no envía y libera el claim', async () => {
		const { supabase, updates } = createSupabaseMock(
			{
				push_subscriptions: [{ data: [] }, { data: null }],
				appointments: [{ data: { ...liveAppointment, status: 'cancelled' }, error: null }]
			},
			{ data: [claimedRow], error: null }
		);

		const result = await sendDuePushReminders(supabase, { now });
		expect(webpush.sendNotification).not.toHaveBeenCalled();
		expect(result.sent).toBe(0);
		expect(updates.some((u) => u.payload.push_24h_claimed_at === null)).toBe(true);
	});

	it('reprogramado fuera de la ventana tras el claim: libera el claim sin enviar', async () => {
		// Carrera claim→reschedule→send: el claim se tomó con el horario viejo (en
		// ventana), pero el turno vivo quedó a 5 días. Enviar consumiría el sent_at de
		// 24h con días de anticipación y el recordatorio real nunca saldría.
		const { supabase, updates } = createSupabaseMock(
			{
				push_subscriptions: [{ data: [] }, { data: null }],
				appointments: [
					{ data: { ...liveAppointment, starts_at: '2026-06-16T11:00:00.000Z' }, error: null }
				]
			},
			{ data: [claimedRow], error: null }
		);

		const result = await sendDuePushReminders(supabase, { now });
		expect(webpush.sendNotification).not.toHaveBeenCalled();
		expect(result.sent).toBe(0);
		expect(updates.some((u) => u.payload.push_24h_claimed_at === null)).toBe(true);
		expect(updates.some((u) => u.payload.push_24h_sent_at)).toBe(false);
	});

	it('sin VAPID configurado no hace nada', async () => {
		delete envState.privateEnv.VAPID_PUBLIC_KEY;
		delete envState.privateEnv.VAPID_PRIVATE_KEY;
		delete envState.publicEnv.PUBLIC_VAPID_PUBLIC_KEY;
		const { supabase } = createSupabaseMock({}, { data: [], error: null });
		const result = await sendDuePushReminders(supabase, { now });
		expect(result).toMatchObject({ configured: false, sent: 0 });
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
		vi.mocked(webpush.sendNotification).mockResolvedValue({} as any);
		const { supabase, updates, filters } = createSupabaseMock(
			{
				appointments: [{ data: liveAppointment, error: null }],
				push_subscriptions: [{ data: [subscriptionRow], error: null }]
			},
			{ data: null, error: null }
		);

		const result = await sendReschedulePushNotice(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			now
		});

		expect(result.sent).toBe(1);
		expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
		expect(payload.body).toContain('reprogramado');
		expect(payload.body).toContain('a las 08:00');
		expect(payload.body).toContain('Descripción pública sintética');
		expect(payload.body).not.toContain('Indicación clínica privada');
		expect(payload.body).not.toContain('Nota interna privada');
		// Mismo tag que el aviso de 24h: pisa la notificación vieja en el navegador.
		expect(payload.tag).toBe('turno-apt-1-24h');
		expect(payload.group).toBe('turno-apt-1');
		expect(payload.url).toContain('/turno/tok-1');
		expect(vi.mocked(webpush.sendNotification).mock.calls[0][2]).toMatchObject({
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

		const result = await sendReschedulePushNotice(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			now
		});
		expect(result.sent).toBe(0);
		expect(webpush.sendNotification).not.toHaveBeenCalled();
	});

	it('endpoint muerto (410): registra el dispositivo sin desvincular el turno', async () => {
		vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 410 });
		const { supabase, updates, rpcCalls } = createSupabaseMock(
			{
				appointments: [{ data: liveAppointment, error: null }],
				push_subscriptions: [{ data: [subscriptionRow], error: null }, { data: null }]
			},
			{ data: null, error: null }
		);

		const result = await sendReschedulePushNotice(supabase, {
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

	it('limpia sent/claimed de 24h y 2h sólo en vínculos asociados', async () => {
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
			push_2h_claimed_at: null,
			push_2h_sent_at: null,
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

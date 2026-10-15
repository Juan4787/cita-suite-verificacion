import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));
const mocks = vi.hoisted(() => ({
	loadAppointmentForToken: vi.fn(),
	getLatestPushTestStatus: vi.fn(),
	getPushDeliveryStatus: vi.fn(),
	isPushConfigured: vi.fn(),
	isValidPushDeliveryId: vi.fn(),
	isValidPushTestRequestKey: vi.fn(),
	isValidSubscriptionPayload: vi.fn(),
	recordPushTestFeedback: vi.fn(),
	saveAppointmentPushSubscription: vi.fn(),
	sendTestPushNotification: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/appointment-token', () => ({
	loadAppointmentForToken: mocks.loadAppointmentForToken
}));
vi.mock('$lib/server/push', () => ({
	getLatestPushTestStatus: mocks.getLatestPushTestStatus,
	getPushDeliveryStatus: mocks.getPushDeliveryStatus,
	isPushConfigured: mocks.isPushConfigured,
	isValidPushDeliveryId: mocks.isValidPushDeliveryId,
	isValidPushTestRequestKey: mocks.isValidPushTestRequestKey,
	isValidSubscriptionPayload: mocks.isValidSubscriptionPayload,
	recordPushTestFeedback: mocks.recordPushTestFeedback,
	saveAppointmentPushSubscription: mocks.saveAppointmentPushSubscription,
	sendTestPushNotification: mocks.sendTestPushNotification
}));

const { POST } = await import('./+server');
const URL = 'https://app.test/turno/public-token/push';
const appointment = {
	id: 'appointment-id',
	is_past: false,
	status: 'reserved'
};
const subscription = {
	endpoint: 'https://push.example/subscription',
	expirationTime: null,
	keys: {
		p256dh: 'p256dh-value',
		auth: 'auth-value'
	}
};

const callPost = (body: unknown) =>
	POST({
		params: { token: 'public-token' },
		request: new Request(URL, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'user-agent': 'SamsungBrowser/28.0'
			},
			body: JSON.stringify(body)
		}),
		fetch: vi.fn(),
		setHeaders: vi.fn()
	} as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	mocks.isPushConfigured.mockReturnValue(true);
	mocks.isValidSubscriptionPayload.mockReturnValue(true);
	mocks.isValidPushTestRequestKey.mockImplementation((key: string) =>
		/^push:session-[a-z0-9-]+:(initial|recovery|refresh)$/.test(key)
	);
	mocks.loadAppointmentForToken.mockResolvedValue({
		appointment,
		supabase: { admin: true }
	});
	mocks.saveAppointmentPushSubscription.mockResolvedValue({
		id: 'subscription-id',
		endpoint: subscription.endpoint,
		verifiedAt: null
	});
	mocks.sendTestPushNotification.mockResolvedValue({
		accepted: true,
		deliveryId: 'delivery-id'
	});
	mocks.getPushDeliveryStatus.mockResolvedValue({
		id: 'delivery-id',
		status: 'displayed'
	});
});

describe('POST /turno/[token]/push', () => {
	it('reutiliza una suscripción ya confirmada sin mandar otra prueba', async () => {
		mocks.saveAppointmentPushSubscription.mockResolvedValueOnce({
			id: 'subscription-id',
			endpoint: subscription.endpoint,
			verifiedAt: '2026-08-04T20:00:00.000Z'
		});

		const response = await callPost({
			subscription,
			test: true,
			testRequestKey: 'push:session-1234567890:initial'
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ok: true,
			verified: true,
			delivery: null,
			verificationAvailable: true
		});
		expect(mocks.sendTestPushNotification).not.toHaveBeenCalled();
	});

	it('envía la clave estable de la prueba al mecanismo idempotente', async () => {
		const response = await callPost({
			subscription,
			test: true,
			testRequestKey: 'push:session-1234567890:recovery'
		});

		expect(response.status).toBe(200);
		expect(mocks.sendTestPushNotification).toHaveBeenCalledOnce();
		expect(mocks.sendTestPushNotification).toHaveBeenCalledWith(
			{ admin: true },
			{
				appointment,
				requestKey: 'push:session-1234567890:recovery',
				subscription: {
					id: 'subscription-id',
					endpoint: subscription.endpoint,
					p256dh: subscription.keys.p256dh,
					auth: subscription.keys.auth
				}
			}
		);
	});

	it('conserva la activación si falla la lectura posterior a una prueba ya aceptada', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mocks.getPushDeliveryStatus.mockRejectedValueOnce(new Error('temporary read failure'));

		const response = await callPost({
			subscription,
			test: true,
			testRequestKey: 'push:session-1234567890:initial'
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ok: true,
			verified: false,
			deliveryId: 'delivery-id',
			delivery: null,
			verificationAvailable: true
		});
		expect(mocks.sendTestPushNotification).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledWith(
			'Error consultando estado de prueba push recién enviada',
			expect.any(Error)
		);
		consoleError.mockRestore();
	});

	it('rechaza una clave inválida antes de guardar o enviar', async () => {
		mocks.isValidPushTestRequestKey.mockReturnValueOnce(false);

		const response = await callPost({
			subscription,
			test: true,
			testRequestKey: 'repetir'
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			message: 'No pudimos preparar la prueba.'
		});
		expect(mocks.saveAppointmentPushSubscription).not.toHaveBeenCalled();
		expect(mocks.sendTestPushNotification).not.toHaveBeenCalled();
	});
});

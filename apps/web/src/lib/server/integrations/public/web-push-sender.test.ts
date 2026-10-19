import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

// Real web-push, real keys: the request the sender builds must be decryptable by
// the browser that owns the subscription (RFC 8291) and carry a valid VAPID
// signature (RFC 8292) for the push service origin.
const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>
}));
vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));

import webpush from 'web-push';
import { PushServiceError, createWebPushSender } from '$lib/server/integrations/public/push';

const vapid = webpush.generateVAPIDKeys();
const browser = crypto.createECDH('prime256v1');
browser.generateKeys();
const authSecret = crypto.randomBytes(16);
const target = {
	endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-device',
	p256dh: browser.getPublicKey().toString('base64url'),
	auth: authSecret.toString('base64url')
};

const recordingFetch = (status = 201) => {
	const requests: Request[] = [];
	const fetchFn: typeof fetch = async (input, init) => {
		requests.push(new Request(input, init));
		return new Response('{}', { status });
	};
	return { fetchFn, requests };
};

// What the user agent does with an aes128gcm message: one record, padding delimiter 2.
const decrypt = (body: Buffer) => {
	const salt = body.subarray(0, 16);
	const keyIdLength = body[20];
	const senderPublicKey = body.subarray(21, 21 + keyIdLength);
	const ciphertext = body.subarray(21 + keyIdLength);
	const sharedSecret = browser.computeSecret(senderPublicKey);
	const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), senderPublicKey]);
	const inputKey = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
	const contentKey = Buffer.from(crypto.hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
	const nonce = Buffer.from(crypto.hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
	const decipher = crypto.createDecipheriv('aes-128-gcm', contentKey, nonce);
	decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
	const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
	return padded.subarray(0, padded.lastIndexOf(2)).toString('utf8');
};

const vapidClaims = (authorization: string) => {
	const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization);
	if (!match) throw new Error('Not a VAPID authorization');
	const [header, claims, signature] = match[1].split('.');
	const publicKey = Buffer.from(match[2], 'base64url');
	const key = crypto.createPublicKey({
		key: { kty: 'EC', crv: 'P-256', x: publicKey.subarray(1, 33).toString('base64url'), y: publicKey.subarray(33).toString('base64url') },
		format: 'jwk'
	});
	const valid = crypto.verify('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
	return { valid, publicKey: match[2], claims: JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) };
};

beforeEach(() => {
	envState.privateEnv.VAPID_PUBLIC_KEY = vapid.publicKey;
	envState.privateEnv.VAPID_PRIVATE_KEY = vapid.privateKey;
	envState.privateEnv.VAPID_SUBJECT = 'mailto:avisos@example.test';
});

describe('envío Web Push mediante fetch', () => {
	it('cifra para la suscripción y firma para el origen del servicio push', async () => {
		const { fetchFn, requests } = recordingFetch();
		const payload = JSON.stringify({ title: 'Turno en Clínica sintética', body: 'Te recordamos tu turno.' });

		const status = await createWebPushSender(fetchFn)(target, payload, { ttlSeconds: 3600, topic: 'Synthetic-topic_1' });

		expect(status).toBe(201);
		expect(requests).toHaveLength(1);
		const [request] = requests;
		expect(request.method).toBe('POST');
		expect(request.url).toBe(target.endpoint);
		expect(request.headers.get('content-encoding')).toBe('aes128gcm');
		expect(request.headers.get('ttl')).toBe('3600');
		expect(request.headers.get('topic')).toBe('Synthetic-topic_1');
		expect(request.headers.get('urgency')).toBe('high');
		expect(decrypt(Buffer.from(await request.arrayBuffer()))).toBe(payload);
		const authorization = vapidClaims(request.headers.get('authorization') ?? '');
		expect(authorization.valid).toBe(true);
		expect(authorization.publicKey).toBe(vapid.publicKey);
		expect(authorization.claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:avisos@example.test' });
	});

	it('firma una vez por origen y cifra cada mensaje con claves nuevas', async () => {
		const sign = vi.spyOn(webpush, 'getVapidHeaders');
		try {
			const { fetchFn, requests } = recordingFetch();
			const send = createWebPushSender(fetchFn);
			await send(target, 'uno', { ttlSeconds: 60, topic: 'a' });
			await send(target, 'dos', { ttlSeconds: 60, topic: 'b' });
			await send({ ...target, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/synthetic' }, 'tres', { ttlSeconds: 60, topic: 'c' });

			expect(sign).toHaveBeenCalledTimes(2);
			const bodies = await Promise.all(requests.map(async (request) => Buffer.from(await request.arrayBuffer())));
			expect(bodies.map(decrypt)).toEqual(['uno', 'dos', 'tres']);
			// A fresh salt and sender key per message.
			expect(new Set(bodies.map((body) => body.subarray(0, 16).toString('hex'))).size).toBe(3);
			expect(vapidClaims(requests[2].headers.get('authorization') ?? '').claims.aud).toBe('https://updates.push.services.mozilla.com');
		} finally {
			sign.mockRestore();
		}
	});

	it('informa el código del proveedor cuando rechaza el mensaje', async () => {
		const { fetchFn } = recordingFetch(410);
		const error = await createWebPushSender(fetchFn)(target, 'x', { ttlSeconds: 60, topic: 'a' }).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(PushServiceError);
		expect(error).toMatchObject({ statusCode: 410 });
	});
});

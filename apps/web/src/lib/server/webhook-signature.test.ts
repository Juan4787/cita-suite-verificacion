import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

// messaging.ts lee WHATSAPP_APP_SECRET de $env/dynamic/private en tiempo de
// ejecución; lo controlamos con un mock hoisted (mismo patrón que push.test.ts).
const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>
}));
vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));

import { verifyWebhookSignature } from './messaging';

const sign = (body: string, secret: string) =>
	'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

beforeEach(() => {
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
});

describe('verifyWebhookSignature', () => {
	const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

	it('FALLA-CERRADO: sin WHATSAPP_APP_SECRET rechaza todo (no procesa payloads forjados)', () => {
		// Aunque el atacante mande una firma "bien formada", sin secret no se puede verificar.
		expect(verifyWebhookSignature(body, sign(body, 'lo-que-sea'))).toBe(false);
		expect(verifyWebhookSignature(body, null)).toBe(false);
	});

	it('acepta una firma HMAC-SHA256 válida con el secret configurado', () => {
		envState.privateEnv.WHATSAPP_APP_SECRET = 'top-secret';
		expect(verifyWebhookSignature(body, sign(body, 'top-secret'))).toBe(true);
	});

	it('rechaza firma calculada con otro secret', () => {
		envState.privateEnv.WHATSAPP_APP_SECRET = 'top-secret';
		expect(verifyWebhookSignature(body, sign(body, 'otro-secret'))).toBe(false);
	});

	it('rechaza header ausente, con prefijo inválido o de largo incorrecto', () => {
		envState.privateEnv.WHATSAPP_APP_SECRET = 'top-secret';
		expect(verifyWebhookSignature(body, null)).toBe(false);
		expect(verifyWebhookSignature(body, '')).toBe(false);
		expect(verifyWebhookSignature(body, 'md5=deadbeef')).toBe(false);
		expect(verifyWebhookSignature(body, 'sha256=corto')).toBe(false);
	});

	it('rechaza si el cuerpo fue alterado tras firmar', () => {
		envState.privateEnv.WHATSAPP_APP_SECRET = 'top-secret';
		const signature = sign(body, 'top-secret');
		expect(verifyWebhookSignature(`${body} tampered`, signature)).toBe(false);
	});
});

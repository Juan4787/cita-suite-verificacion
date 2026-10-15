import { describe, expect, it } from 'vitest';
import {
	DEFAULT_BOT_REPLY_TEMPLATE_BODY,
	DEFAULT_REMINDER_TEMPLATE_BODY,
	MockMessagingProvider,
	buildBotReplyText,
	formatReminderDateTime,
	getExternalCallbackSiteUrl,
	humanMessagingError,
	isHumanRequest,
	renderTemplateBody,
	type MessagingAccount
} from './messaging';

const account: MessagingAccount = {
	id: 'account-1',
	business_id: 'business-1',
	provider: 'mock',
	status: 'active',
	phone_number: '+5490000000000',
	phone_number_id: 'mock-number',
	waba_id: null,
	display_name: 'WhatsApp demo',
	access_token_secret_name: null,
	bot_enabled: true,
	reminders_enabled: true,
	last_error: null
};

describe('messaging helpers', () => {
	it('renderiza el template de recordatorio con variables posicionales', () => {
		const body = renderTemplateBody(DEFAULT_REMINDER_TEMPLATE_BODY, [
			'Juan',
			'Consultorio',
			'miércoles 13 de mayo',
			'10:30',
			'https://example.com/turno/token'
		]);

		expect(body).toContain('Hola Juan');
		expect(body).toContain('Consultorio');
		expect(body).toContain('miércoles 13 de mayo');
		expect(body).toContain('https://example.com/turno/token');
	});

	it('formatea fecha y hora usando la zona horaria del negocio', () => {
		const result = formatReminderDateTime(
			'2026-05-13T13:30:00.000Z',
			'America/Argentina/Cordoba'
		);

		expect(result.dateLabel).toContain('13 de mayo');
		expect(result.timeLabel).toContain('10:30');
	});

	it('detecta pedidos de atención humana sin usar conversación clínica', () => {
		expect(isHumanRequest('quiero hablar con recepción')).toBe(true);
		expect(isHumanRequest('necesito un asesor')).toBe(true);
		expect(isHumanRequest('hola')).toBe(false);
	});

	it('construye una respuesta reactiva con el enlace público de reserva', () => {
		const businessId = '11111111-1111-4111-8111-111111111111';
		const text = buildBotReplyText({ id: businessId, name: 'Consultorio Sonrisa' });

		expect(text).toContain('Consultorio Sonrisa');
		expect(text).toContain(`/reservar/${businessId}`);
		expect(text).not.toContain('sonrisa');
		expect(text).toContain('asesor');
	});

	it('renderiza el mensaje automático configurable del bot', () => {
		const businessId = '11111111-1111-4111-8111-111111111111';
		const text = buildBotReplyText(
			{ id: businessId, name: 'Consultorio Norte' },
			'Hola, somos {{business_name}}. Reservá acá: {{booking_url}}'
		);

		expect(DEFAULT_BOT_REPLY_TEMPLATE_BODY).toContain('{{booking_url}}');
		expect(text).toContain('Hola, somos Consultorio Norte.');
		expect(text).toContain(`/reservar/${businessId}`);
	});

	it('traduce errores técnicos a mensajes operativos', () => {
		expect(humanMessagingError(new Error('WHATSAPP_ACCESS_TOKEN_MISSING'))).toBe(
			'Falta configurar el token de WhatsApp.'
		);
		expect(humanMessagingError(new Error('TEMPLATE_NOT_APPROVED'))).toBe(
			'El template de recordatorio todavía no está aprobado.'
		);
		expect(humanMessagingError(new Error('PATIENT_PHONE_MISSING'))).toBe(
			'El paciente no tiene un teléfono válido.'
		);
		const fallback = humanMessagingError(new Error('PROVIDER_UNKNOWN'));
		expect(fallback).toContain('mensaje');
		expect(fallback).toContain('configuración');
		expect(fallback).not.toMatch(/PROVIDER_|SQL|HTTP|RPC/);
	});

	it('usa una URL HTTPS pública para callbacks externos aunque el entorno local sea localhost', () => {
		expect(getExternalCallbackSiteUrl()).toMatch(/^https:\/\//);
		expect(getExternalCallbackSiteUrl()).not.toContain('localhost');
		expect(getExternalCallbackSiteUrl()).not.toContain('127.0.0.1');
	});
});

describe('MockMessagingProvider', () => {
	it('simula envío de templates sin depender de Meta', async () => {
		const provider = new MockMessagingProvider();
		const result = await provider.sendTemplate({
			account,
			to: '+5493420000000',
			templateName: 'appointment_reminder_24h',
			language: 'es_AR',
			variables: ['Juan', 'Consultorio', 'miércoles', '10:30', 'https://example.com']
		});

		expect(result.providerMessageId).toMatch(/^mock_/);
		expect(result.raw).toMatchObject({
			mock: true,
			kind: 'template',
			to: '+5493420000000'
		});
	});

	it('simula respuestas libres del bot', async () => {
		const provider = new MockMessagingProvider();
		const result = await provider.sendFreeForm({
			account,
			to: '+5493420000000',
			text: 'Hola'
		});

		expect(result.providerMessageId).toMatch(/^mock_/);
		expect(result.raw).toMatchObject({
			mock: true,
			kind: 'text',
			text: 'Hola'
		});
	});
});

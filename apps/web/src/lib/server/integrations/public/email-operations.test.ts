import { describe, expect, it } from 'vitest';
import {
	EmailOperationsFormError,
	emailOperationWarnings,
	emailOperationsErrorKind,
	parseCreditForm,
	parseEmailOperations,
	parseSendingForm,
	type EmailOperations
} from './email-operations';

const now = new Date('2026-11-06T15:00:00Z');
const row = (changes: Record<string, unknown> = {}) => ({
	revision: 4, producer_enabled: true, producer_enabled_at: '2026-11-06T10:00:00Z', paused_until: null, pause_reason: null,
	daily_limit: 500, daily_reserve: 10, used_24h: 12, credit_messages: 10000, credit_started_at: '2026-11-05T03:00:00Z',
	credit_expires_at: '2026-12-04T02:59:59Z', credit_used: 3, uncertain: 0, failed_7d: 0,
	senders: [{ business_id: 'b1', business_name: 'Consultorio de prueba', domain: 'prueba-correo.cita-suite.com.ar', state: 'verified', ready: true }],
	...changes
});
const ops = (changes: Record<string, unknown> = {}): EmailOperations => parseEmailOperations(row(changes));
const messages = (value: EmailOperations, at = now) => emailOperationWarnings(value, at).map((warning) => `${warning.level}: ${warning.message}`);
const form = (values: Record<string, string | string[]>) => {
	const data = new FormData();
	for (const [name, value] of Object.entries(values)) for (const item of [value].flat()) data.append(name, item);
	return data;
};

describe('operación del correo', () => {
	it('lee los hechos sin suponer un crédito que nadie registró', () => {
		expect(ops().credit).toEqual({ messages: 10000, startedAt: '2026-11-05T03:00:00Z', expiresAt: '2026-12-04T02:59:59Z', used: 3 });
		expect(ops({ credit_messages: null, credit_started_at: null, credit_expires_at: null, credit_used: null }).credit).toBeNull();
		expect(() => ops({ used_24h: -1 })).toThrow();
		expect(() => ops({ senders: [{ business_id: 'b1', business_name: 'X', domain: null, state: 'otro', ready: false }] })).toThrow();
	});

	it('con crédito vigente y holgado no hay nada que avisar', () => {
		expect(messages(ops())).toEqual([]);
	});

	it('avisa el vencimiento desde 14 días calendario antes, con la fecha argentina', () => {
		expect(messages(ops(), new Date('2026-11-18T23:59:00-03:00'))).toEqual([]);
		expect(messages(ops(), new Date('2026-11-19T03:30:00-03:00'))).toEqual(['attention: El crédito vence el 3 de diciembre de 2026: faltan 14 días. Comprá otro antes para que no se corten los envíos.']);
		expect(messages(ops(), new Date('2026-11-19T15:00:00Z'))).toEqual(['attention: El crédito vence el 3 de diciembre de 2026: faltan 14 días. Comprá otro antes para que no se corten los envíos.']);
		expect(messages(ops(), new Date('2026-12-02T15:00:00Z'))).toEqual(['attention: El crédito vence el 3 de diciembre de 2026: falta 1 día. Comprá otro antes para que no se corten los envíos.']);
		expect(messages(ops(), new Date('2026-12-03T12:00:00Z'))).toEqual(['attention: El crédito vence hoy (3 de diciembre de 2026). Comprá otro antes para que no se corten los envíos.']);
	});

	it('un crédito vencido o agotado es urgente; uno escaso pide atención', () => {
		expect(messages(ops(), new Date('2026-12-04T03:00:00Z'))[0]).toBe('critical: El crédito venció el 3 de diciembre de 2026. Zoho no envía más correos hasta que compres otro y lo registres acá.');
		expect(messages(ops({ credit_used: 10000 }))).toEqual(['critical: Ya salieron los 10000 correos del crédito registrado. Comprá otro: Zoho deja de enviar cuando se agota.']);
		expect(messages(ops({ credit_used: 12000 }))[0]).toContain('Ya salieron los 10000 correos');
		expect(messages(ops({ credit_used: 9000 }))).toEqual(['attention: Quedan aproximadamente 1000 correos del crédito registrado, de 10000.']);
		expect(messages(ops({ credit_used: 8999 }))).toEqual([]);
		// A small credit keeps a margin of 200, not a tenth.
		expect(messages(ops({ credit_messages: 500, credit_used: 300 }))).toEqual(['attention: Quedan aproximadamente 200 correos del crédito registrado, de 500.']);
	});

	it('sin crédito registrado lo pide, porque Zoho no informa el saldo', () => {
		expect(messages(ops({ credit_messages: null, credit_started_at: null, credit_expires_at: null, credit_used: null }))).toEqual([
			'attention: No hay un crédito registrado. Registrá el que compraste: Zoho no informa el saldo, y sin ese dato la app no puede avisar antes de que venza o se agote.'
		]);
	});

	it('la pausa va primero, con su motivo y la hora argentina', () => {
		expect(messages(ops({ paused_until: '2026-11-06T15:15:00Z', pause_reason: 'SERR_157', uncertain: 2, producer_enabled: false }))).toEqual([
			'critical: Los envíos están en pausa hasta las 12:15 porque el proveedor rechazó la clave o la cuenta (SERR_157). Revisá la cuenta de Zoho antes de levantar la pausa.',
			'info: El envío automático está apagado: no se registra ni se envía ningún correo nuevo.',
			'attention: 2 correos están en comprobación. Cada consultorio lo decide desde el detalle del turno.'
		]);
	});

	it('el formulario de envío cambia el interruptor, el límite y la pausa, y conserva el crédito', () => {
		expect(parseSendingForm(form({ expected_revision: '4', daily_limit: '300', producer_enabled: 'true', lift_pause: 'true' }), ops())).toEqual({
			expectedRevision: 4, producerEnabled: true, dailyLimit: 300, liftPause: true,
			credit: { messages: 10000, startedAt: '2026-11-05T03:00:00Z', expiresAt: '2026-12-04T02:59:59Z' }
		});
		expect(parseSendingForm(form({ expected_revision: '4', daily_limit: '0' }), ops())).toMatchObject({ producerEnabled: false, dailyLimit: 0, liftPause: false });
		for (const values of [{ expected_revision: '4', daily_limit: '-1' }, { expected_revision: '4', daily_limit: '1,5' }, { expected_revision: 'x', daily_limit: '10' },
			{ expected_revision: ['4', '5'], daily_limit: '10' }])
			expect(() => parseSendingForm(form(values), ops())).toThrow(EmailOperationsFormError);
	});

	it('un crédito nuevo dura desde el día de compra hasta el final de su vencimiento, en Argentina', () => {
		expect(parseCreditForm(form({ expected_revision: '4', credit_messages: '10.000', credit_started_on: '2026-11-05', credit_expires_on: '2026-12-03' }), ops())).toEqual({
			expectedRevision: 4, producerEnabled: true, dailyLimit: 500, liftPause: false,
			credit: { messages: 10000, startedAt: '2026-11-05T00:00:00-03:00', expiresAt: '2026-12-03T23:59:59-03:00' }
		});
		for (const values of [
			{ expected_revision: '4', credit_messages: '0', credit_started_on: '2026-11-05', credit_expires_on: '2026-12-03' },
			{ expected_revision: '4', credit_messages: '10000', credit_started_on: '2026-11-05', credit_expires_on: '2026-02-30' },
			{ expected_revision: '4', credit_messages: '10000', credit_started_on: '2026-12-05', credit_expires_on: '2026-12-03' },
			{ expected_revision: '4', credit_messages: '10000', credit_started_on: '', credit_expires_on: '2026-12-03' }
		])
			expect(() => parseCreditForm(form(values), ops())).toThrow(EmailOperationsFormError);
	});

	it('distingue un cambio ajeno de un valor rechazado y de una falla', () => {
		expect(emailOperationsErrorKind({ message: 'EMAIL_OPERATIONS_CHANGED' })).toBe('changed');
		expect(emailOperationsErrorKind(new Error('EMAIL_OPERATIONS_INVALID'))).toBe('invalid');
		expect(emailOperationsErrorKind({ message: 'timeout' })).toBe('unknown');
	});
});

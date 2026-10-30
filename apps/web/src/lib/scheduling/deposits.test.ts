import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from '$lib/utils/format';
import { InvalidDataContractError } from '$lib/contracts/json';
import {
	DEPOSIT_SECTIONS,
	DEPOSIT_STATUS_LABELS,
	DEPOSIT_TERMS_UNAVAILABLE_NOTICE,
	describeDepositAutomation,
	formatElapsed,
	classifyDeposit,
	buildDepositCancellationMessage,
	buildDepositRequestMessage,
	buildDepositTermsNotice,
	formatDepositAmount,
	parseAppointmentDeposit
} from './deposits';

// The practice is in Tokyo on purpose: its wall clock differs from Argentina's and from the
// machine's, so a message built with the wrong timezone shows another hour or day.
const PRACTICE_TIMEZONE = 'Asia/Tokyo';
const STARTS_AT = '2026-11-20T01:00:00.000Z'; // 10:00 on 20 November in Tokyo
const DUE_AT = '2026-11-18T01:00:00.000Z'; // 10:00 on 18 November in Tokyo

const row = (overrides: Record<string, unknown> = {}) => ({
	appointment_id: '00000000-0000-4000-8000-0000000000a1',
	status: 'pending',
	amount: 40000,
	currency: 'ARS',
	request_from: '2026-11-12T15:00:00.000Z',
	due_at: DUE_AT,
	auto_cancel: true,
	waived_reason: null,
	recorded_at: null,
	reminder_opened_at: null,
	expired_at: null,
	revision: 3,
	...overrides
});

describe('lectura de la seña', () => {
	it('la máquina de prueba no está en la zona del consultorio', () => {
		expect(new Date(STARTS_AT).getTimezoneOffset()).not.toBe(-540);
	});

	it('devuelve la seña validada y nada si el turno no la exige', () => {
		expect(parseAppointmentDeposit(null)).toBeNull();
		expect(parseAppointmentDeposit(row())).toEqual({
			appointment_id: '00000000-0000-4000-8000-0000000000a1',
			status: 'pending',
			amount: 40000,
			currency: 'ARS',
			request_from: '2026-11-12T15:00:00.000Z',
			due_at: DUE_AT,
			auto_cancel: true,
			waived_reason: null,
			recorded_at: null,
			reminder_opened_at: null,
			expired_at: null,
			revision: 3
		});
	});

	it('rechaza una fila incompleta o con valores imposibles, en vez de mostrar datos falsos', () => {
		for (const broken of [
			row({ status: 'maybe' }),
			row({ amount: 0 }),
			row({ amount: 40000.5 }),
			row({ currency: 'USD' }),
			row({ revision: 0 }),
			row({ due_at: 'mañana' }),
			row({ waived_reason: 'otra' }),
			row({ auto_cancel: 'true' })
		]) {
			expect(() => parseAppointmentDeposit(broken)).toThrow(InvalidDataContractError);
		}
	});

	it('cada estado tiene su nombre para la pantalla', () => {
		expect(DEPOSIT_STATUS_LABELS).toEqual({
			pending: 'Seña pendiente',
			paid: 'Seña recibida',
			waived: 'Seña exceptuada',
			expired: 'Seña vencida'
		});
	});
});

describe('pedido de seña por WhatsApp', () => {
	const input = {
		patientName: 'Ana Pérez',
		businessName: 'Consultorio Natalia',
		startsAt: STARTS_AT,
		dueAt: DUE_AT,
		timezone: PRACTICE_TIMEZONE,
		amount: 40000,
		transferDetails: 'Alias natalia.frutos',
		autoCancel: true,
		publicUrl: 'https://app.cita-suite.com.ar/turno/token'
	};

	it('pide la seña con monto, vencimiento y datos, avisa la baja y aclara qué hacer si ya transfirió', () => {
		const turn = formatInTimeZone(STARTS_AT, PRACTICE_TIMEZONE);
		const due = formatInTimeZone(DUE_AT, PRACTICE_TIMEZONE);
		expect(turn.timeLabel).toBe('10:00');
		expect(buildDepositRequestMessage(input)).toBe(
			[
				`Hola Ana Pérez. Te escribimos de Consultorio Natalia por tu turno del ${turn.dateLabel} a las 10:00.`,
				`Para confirmarlo necesitamos la seña de ${formatDepositAmount(40000)} antes del ${due.dateLabel} a las 10:00.`,
				'Datos para transferir: Alias natalia.frutos',
				'Si no la recibimos para esa fecha, el turno se libera automáticamente.',
				'Si ya la transferiste, desestimá este mensaje (si podés, mandanos el comprobante por acá).',
				'Ver tu turno: https://app.cita-suite.com.ar/turno/token'
			].join('\n')
		);
	});

	it('sin baja automática no promete liberar el turno, y sin datos de transferencia no los inventa', () => {
		const message = buildDepositRequestMessage({ ...input, autoCancel: false, transferDetails: null });
		expect(message).not.toContain('se libera automáticamente');
		expect(message).not.toContain('Datos para transferir');
		expect(message).toContain('Si ya la transferiste, desestimá este mensaje');
	});

	it('no nombra la prestación ni datos clínicos', () => {
		expect(buildDepositRequestMessage(input)).not.toMatch(/consulta|primera|seguimiento|diagn/i);
	});
});

describe('aviso de turno cancelado por la seña', () => {
	it('explica el motivo con la fecha del consultorio y ofrece resolverlo o reservar de nuevo', () => {
		const turn = formatInTimeZone(STARTS_AT, PRACTICE_TIMEZONE);
		const due = formatInTimeZone(DUE_AT, PRACTICE_TIMEZONE);
		expect(
			buildDepositCancellationMessage({
				patientName: 'Ana Pérez',
				businessName: 'Consultorio Natalia',
				startsAt: STARTS_AT,
				dueAt: DUE_AT,
				timezone: PRACTICE_TIMEZONE,
				bookingUrl: 'https://app.cita-suite.com.ar/reservar/natalia'
			})
		).toBe(
			[
				`Hola Ana Pérez. Tu turno del ${turn.dateLabel} a las 10:00 en Consultorio Natalia se canceló porque no registramos la seña antes del ${due.dateLabel} a las 10:00.`,
				'Si ya la transferiste, respondé este mensaje con el comprobante y lo resolvemos.',
				'Si querés otro turno, podés reservarlo acá: https://app.cita-suite.com.ar/reservar/natalia'
			].join('\n')
		);
	});

	it('sin enlace de reserva no inventa uno', () => {
		const message = buildDepositCancellationMessage({
			patientName: 'Ana Pérez',
			businessName: 'Consultorio Natalia',
			startsAt: STARTS_AT,
			dueAt: DUE_AT,
			timezone: PRACTICE_TIMEZONE,
			bookingUrl: null
		});
		expect(message.split('\n')).toHaveLength(2);
		expect(message).not.toContain('reservarlo acá');
	});
});

describe('sección de la lista de señas', () => {
	const now = new Date('2026-11-10T12:00:00.000Z');
	const hours = (value: number) => new Date(now.getTime() + value * 3_600_000).toISOString();
	const deposit = (overrides: Record<string, unknown> = {}) =>
		parseAppointmentDeposit(row({ request_from: hours(-1), due_at: hours(72), ...overrides }))!;
	const turn = (status: string, startsInHours = 120) => ({ status, startsAt: hours(startsInHours) });

	it('ubica cada seña pendiente según lo que el consultorio tiene que hacer ahora', () => {
		expect(classifyDeposit(deposit(), turn('reserved'), now)).toBe('to_request');
		expect(classifyDeposit(deposit({ request_from: hours(5) }), turn('reserved'), now)).toBe('later');
		expect(classifyDeposit(deposit({ due_at: hours(23) }), turn('reserved'), now)).toBe('due_soon');
		expect(classifyDeposit(deposit({ due_at: hours(-1) }), turn('reserved'), now)).toBe('overdue');
		expect(classifyDeposit(deposit({ auto_cancel: false }), turn('reserved'), now)).toBe('manual');
		expect(classifyDeposit(deposit({ auto_cancel: false, due_at: hours(-1) }), turn('reserved'), now)).toBe('overdue');
		expect(classifyDeposit(deposit(), turn('reschedule_requested'), now)).toBe('manual');
	});

	it('un turno que ya empezó no deja nada por decidir, aunque su seña siga pendiente', () => {
		expect(classifyDeposit(deposit({ due_at: hours(-50) }), turn('reserved', -2), now)).toBeNull();
		expect(classifyDeposit(deposit({ due_at: hours(-48) }), turn('reserved', 0), now)).toBeNull();
		expect(classifyDeposit(deposit({ due_at: hours(-47) }), turn('reserved', 1), now)).toBe('overdue');
	});

	it('una cancelada por la seña queda a la vista siete días, para avisarle a la persona', () => {
		const expired = deposit({ status: 'expired', expired_at: hours(-24 * 6) });
		expect(classifyDeposit(expired, turn('cancelled'), now)).toBe('cancelled');
		expect(classifyDeposit(deposit({ status: 'expired', expired_at: hours(-24 * 8) }), turn('cancelled'), now)).toBeNull();
	});

	it('las resueltas y las de turnos cerrados por otro motivo no aparecen', () => {
		expect(classifyDeposit(deposit({ status: 'paid', recorded_at: hours(-1) }), turn('confirmed'), now)).toBeNull();
		expect(classifyDeposit(deposit({ status: 'waived', waived_reason: 'staff' }), turn('confirmed'), now)).toBeNull();
		expect(classifyDeposit(deposit(), turn('cancelled'), now)).toBeNull();
	});
});

describe('aviso de la seña antes de reservar', () => {
	const due = formatInTimeZone(DUE_AT, PRACTICE_TIMEZONE);
	const now = new Date('2026-11-10T12:00:00.000Z');
	// The amount uses a non-breaking space; both sides are compared with plain spaces.
	const plain = (text: string) => text.replace(/\s+/g, ' ');

	it('con baja automática dice monto, plazo en la zona del consultorio y que el turno se cancela solo', () => {
		expect(plain(buildDepositTermsNotice({ amount: 40000, dueAt: DUE_AT, autoCancel: true }, PRACTICE_TIMEZONE, now))).toBe(
			plain(
				`Este turno requiere una seña de ${formatDepositAmount(40000)}. Tenés tiempo hasta el ${due.dateLabel} a las 10:00 para transferirla. Si no se registra, el turno se cancela automáticamente.`
			)
		);
		expect(due.dateLabel).toMatch(/miércoles.*18 de noviembre/);
	});

	it('sin baja automática para ese horario no la promete', () => {
		const notice = buildDepositTermsNotice({ amount: 40000, dueAt: DUE_AT, autoCancel: false }, PRACTICE_TIMEZONE, now);
		expect(notice).toMatch(/para transferirla\.$/);
		expect(notice).not.toMatch(/cancela/);
	});

	it('con el vencimiento ya pasado pide transferir apenas reserve, sin una fecha imposible', () => {
		const notice = buildDepositTermsNotice(
			{ amount: 40000, dueAt: DUE_AT, autoCancel: false },
			PRACTICE_TIMEZONE,
			new Date(DUE_AT)
		);
		expect(notice).toBe(
			`Este turno requiere una seña de ${formatDepositAmount(40000)}. Transferila apenas reserves: el consultorio confirma el turno cuando la recibe.`
		);
	});

	it('si no se pudieron calcular las condiciones lo dice, sin prometer que no hay seña', () => {
		expect(DEPOSIT_TERMS_UNAVAILABLE_NOTICE).toBe(
			'No pudimos calcular si este turno requiere una seña. Si corresponde, la vas a ver al terminar la reserva.'
		);
	});
});

describe('página de señas', () => {
	const now = new Date('2026-11-10T12:00:00.000Z');
	const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

	it('las secciones siguen el orden del plan, con «Más adelante» plegada', () => {
		expect(DEPOSIT_SECTIONS.map((section) => section.title)).toEqual([
			'Para pedir',
			'Vencen en menos de 24 horas',
			'Último momento: resolver a mano',
			'Vencidas sin cancelar: decidir',
			'Más adelante',
			'Canceladas por falta de seña, últimos 7 días'
		]);
		expect(DEPOSIT_SECTIONS.filter((section) => section.folded).map((section) => section.id)).toEqual(['later']);
	});

	it('dice cuánto pasó con palabras simples', () => {
		expect(formatElapsed(ago(0), now)).toBe('recién');
		expect(formatElapsed(ago(12), now)).toBe('hace 12 min');
		expect(formatElapsed(ago(180), now)).toBe('hace 3 h');
		expect(formatElapsed(ago(60 * 24), now)).toBe('hace 1 día');
		expect(formatElapsed(ago(60 * 24 * 3), now)).toBe('hace 3 días');
		expect(formatElapsed(new Date(now.getTime() + 60_000).toISOString(), now)).toBe('recién');
	});

	it('muestra la última revisión automática y alerta pasados 20 minutos', () => {
		const status = (minutes: number) => ({ enabled: true, lastRunFinishedAt: ago(minutes) });
		expect(describeDepositAutomation({ practiceAutoCancel: true, status: status(3), now })).toEqual({
			tone: 'ok',
			text: 'Última revisión automática: hace 3 min.'
		});
		expect(describeDepositAutomation({ practiceAutoCancel: true, status: status(20), now }).tone).toBe('ok');
		expect(describeDepositAutomation({ practiceAutoCancel: true, status: status(21), now })).toEqual({
			tone: 'warning',
			text: 'La revisión automática no corre desde hace 21 min. Revisá a mano las señas vencidas.'
		});
	});

	it('explica por qué nada se cancela solo, y nunca presenta como sana una revisión desconocida', () => {
		expect(describeDepositAutomation({ practiceAutoCancel: false, status: null, now }).tone).toBe('info');
		expect(describeDepositAutomation({ practiceAutoCancel: true, status: null, now })).toEqual({
			tone: 'warning',
			text: 'No pudimos comprobar la revisión automática. Revisá a mano las señas vencidas.'
		});
		expect(describeDepositAutomation({ practiceAutoCancel: true, status: { enabled: false, lastRunFinishedAt: ago(1) }, now }).text).toMatch(
			/detenida por el operador/
		);
		expect(describeDepositAutomation({ practiceAutoCancel: true, status: { enabled: true, lastRunFinishedAt: null }, now }).text).toMatch(
			/todavía no corrió/
		);
	});
});

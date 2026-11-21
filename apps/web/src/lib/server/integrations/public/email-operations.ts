// What the operator sees and decides about the appointment email: the credit bought from the
// provider, the shared daily cap, the producer switch and pauses. Zoho exposes neither balance nor
// expiry (docs/plans/plan-integral-avisos-20261105.md, 4.3), so the warnings come from what the
// operator recorded and from the app's own count, never from the provider answering (case ZH04).
import { isRecord, readBoolean, readChoice, readFiniteNumber, readNullableText, readRecord, readText } from '$lib/contracts/json';
import type { CitaSupabaseClient } from '$lib/types/database';
import { EMAIL_DOMAIN_STATES } from '$lib/server/scheduling/public/email-status';
import { calendarDaysUntil } from '$lib/utils/calendar-days';

export type EmailCredit = { messages: number; startedAt: string; expiresAt: string; used: number };
export type EmailOperations = {
	revision: number;
	producerEnabled: boolean;
	producerEnabledAt: string | null;
	pausedUntil: string | null;
	pauseReason: string | null;
	dailyLimit: number;
	dailyReserve: number;
	used24h: number;
	credit: EmailCredit | null;
	uncertain: number;
	failed7d: number;
	senders: { businessId: string; businessName: string; domain: string | null; state: (typeof EMAIL_DOMAIN_STATES)[number]; ready: boolean }[];
};
export type EmailOperationWarning = { level: 'critical' | 'attention' | 'info'; message: string };

const count = (value: unknown, label: string) => {
	const number = readFiniteNumber(value, label);
	if (!Number.isInteger(number) || number < 0) throw new Error(label);
	return number;
};

export const parseEmailOperations = (value: unknown): EmailOperations => {
	const row = readRecord(value, 'email.operations');
	const messages = row.credit_messages === null ? null : count(row.credit_messages, 'email.operations.credit');
	const senders = Array.isArray(row.senders) ? row.senders : [];
	return {
		revision: count(row.revision, 'email.operations.revision'),
		producerEnabled: readBoolean(row.producer_enabled, 'email.operations.producer'),
		producerEnabledAt: readNullableText(row.producer_enabled_at, 'email.operations.producerAt'),
		pausedUntil: readNullableText(row.paused_until, 'email.operations.pausedUntil'),
		pauseReason: readNullableText(row.pause_reason, 'email.operations.pauseReason'),
		dailyLimit: count(row.daily_limit, 'email.operations.limit'),
		dailyReserve: count(row.daily_reserve, 'email.operations.reserve'),
		used24h: count(row.used_24h, 'email.operations.used'),
		credit: messages === null ? null : {
			messages,
			startedAt: readText(row.credit_started_at, 'email.operations.creditStart'),
			expiresAt: readText(row.credit_expires_at, 'email.operations.creditExpiry'),
			used: count(row.credit_used, 'email.operations.creditUsed')
		},
		uncertain: count(row.uncertain, 'email.operations.uncertain'),
		failed7d: count(row.failed_7d, 'email.operations.failed'),
		senders: senders.map((entry) => {
			const sender = readRecord(entry, 'email.operations.sender');
			return {
				businessId: readText(sender.business_id, 'email.operations.sender.business'),
				businessName: readText(sender.business_name, 'email.operations.sender.name'),
				domain: readNullableText(sender.domain, 'email.operations.sender.domain'),
				state: readChoice(sender.state, EMAIL_DOMAIN_STATES, 'email.operations.sender.state'),
				ready: readBoolean(sender.ready, 'email.operations.sender.ready')
			};
		})
	};
};

export const loadEmailOperations = async (admin: CitaSupabaseClient) => {
	const { data, error } = await admin.rpc('operator_get_email_operations', {});
	if (error) throw error;
	return parseEmailOperations(data);
};

/** Days before expiry when the operator starts being warned. */
export const CREDIT_EXPIRY_NOTICE_DAYS = 14;
/** What is left is counted conservatively, so a tenth of the credit, or 200, is the margin to buy more. */
export const creditLowThreshold = (messages: number) => Math.max(200, Math.ceil(messages / 10));
export const creditRemaining = (credit: EmailCredit) => Math.max(0, credit.messages - credit.used);

// The operator works in Argentina, which has no daylight saving time since 2009.
const OPERATOR_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const OPERATOR_OFFSET = '-03:00';
const day = (iso: string) => new Intl.DateTimeFormat('es-AR', { timeZone: OPERATOR_TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
const hour = (iso: string) => new Intl.DateTimeFormat('es-AR', { timeZone: OPERATOR_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const plural = (amount: number, one: string, many: string) => (amount === 1 ? one : many);

/** Most urgent first. Each says what happens and what to do; none depends on the provider answering. */
export const emailOperationWarnings = (ops: EmailOperations, now: Date): EmailOperationWarning[] => {
	const warnings: EmailOperationWarning[] = [];
	if (ops.pausedUntil)
		warnings.push({ level: 'critical', message: `Los envíos están en pausa hasta las ${hour(ops.pausedUntil)} porque el proveedor rechazó la clave o la cuenta (${ops.pauseReason ?? 'sin código'}). Revisá la cuenta de Zoho antes de levantar la pausa.` });
	if (!ops.credit) {
		warnings.push({ level: 'attention', message: 'No hay un crédito registrado. Registrá el que compraste: Zoho no informa el saldo, y sin ese dato la app no puede avisar antes de que venza o se agote.' });
	} else {
		const remaining = creditRemaining(ops.credit);
		const left = Date.parse(ops.credit.expiresAt) - now.getTime();
		if (left <= 0) {
			warnings.push({ level: 'critical', message: `El crédito venció el ${day(ops.credit.expiresAt)}. Zoho no envía más correos hasta que compres otro y lo registres acá.` });
		} else {
			const days = calendarDaysUntil(ops.credit.expiresAt, now, OPERATOR_TIME_ZONE);
			if (days !== null && days <= 0)
				warnings.push({ level: 'attention', message: `El crédito vence hoy (${day(ops.credit.expiresAt)}). Comprá otro antes para que no se corten los envíos.` });
			else if (days !== null && days <= CREDIT_EXPIRY_NOTICE_DAYS)
				warnings.push({ level: 'attention', message: `El crédito vence el ${day(ops.credit.expiresAt)}: ${plural(days, 'falta 1 día', `faltan ${days} días`)}. Comprá otro antes para que no se corten los envíos.` });
		}
		if (remaining === 0)
			warnings.push({ level: 'critical', message: `Ya salieron los ${ops.credit.messages} correos del crédito registrado. Comprá otro: Zoho deja de enviar cuando se agota.` });
		else if (remaining <= creditLowThreshold(ops.credit.messages))
			warnings.push({ level: 'attention', message: `Quedan aproximadamente ${remaining} ${plural(remaining, 'correo', 'correos')} del crédito registrado, de ${ops.credit.messages}.` });
	}
	if (!ops.producerEnabled)
		warnings.push({ level: 'info', message: 'El envío automático está apagado: no se registra ni se envía ningún correo nuevo.' });
	if (ops.uncertain > 0)
		warnings.push({ level: 'attention', message: `${ops.uncertain} ${plural(ops.uncertain, 'correo está', 'correos están')} en comprobación. Cada consultorio lo decide desde el detalle del turno.` });
	return warnings;
};

export type EmailOperationsChange = {
	expectedRevision: number;
	producerEnabled: boolean;
	dailyLimit: number;
	credit: { messages: number; startedAt: string; expiresAt: string } | null;
	liftPause: boolean;
};

export class EmailOperationsFormError extends Error {}

const field = (form: FormData, name: string) => {
	const values = form.getAll(name);
	if (values.length > 1) throw new EmailOperationsFormError('Hay datos repetidos en el formulario. Recargá la página.');
	const value = values[0];
	return typeof value === 'string' ? value.trim() : '';
};
const wholeNumber = (text: string, max: number) => (/^\d{1,9}$/.test(text) && Number(text) <= max ? Number(text) : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (text: string) => DATE.test(text) && !Number.isNaN(Date.parse(`${text}T12:00:00${OPERATOR_OFFSET}`)) &&
	new Date(`${text}T12:00:00${OPERATOR_OFFSET}`).toISOString().slice(0, 10) === text;

/** The sending form changes only the switch, the cap and the pause; the credit stays as it is. */
export const parseSendingForm = (form: FormData, current: EmailOperations): EmailOperationsChange => {
	const revision = wholeNumber(field(form, 'expected_revision'), Number.MAX_SAFE_INTEGER);
	const limit = wholeNumber(field(form, 'daily_limit'), 1_000_000);
	if (revision === null) throw new EmailOperationsFormError('La pantalla quedó vieja. Recargala antes de guardar.');
	if (limit === null) throw new EmailOperationsFormError('El límite diario tiene que ser un número entero entre 0 y 1.000.000.');
	return { expectedRevision: revision, producerEnabled: field(form, 'producer_enabled') === 'true', dailyLimit: limit,
		credit: current.credit && { messages: current.credit.messages, startedAt: current.credit.startedAt, expiresAt: current.credit.expiresAt },
		liftPause: field(form, 'lift_pause') === 'true' };
};

/** A new credit starts on its purchase day and lasts through its expiry day, in Argentina. */
export const parseCreditForm = (form: FormData, current: EmailOperations): EmailOperationsChange => {
	const revision = wholeNumber(field(form, 'expected_revision'), Number.MAX_SAFE_INTEGER);
	if (revision === null) throw new EmailOperationsFormError('La pantalla quedó vieja. Recargala antes de guardar.');
	const messages = wholeNumber(field(form, 'credit_messages').replace(/\./g, ''), 100_000_000);
	const started = field(form, 'credit_started_on'), expires = field(form, 'credit_expires_on');
	if (messages === null || messages < 1) throw new EmailOperationsFormError('Indicá cuántos correos incluye el crédito, como número entero.');
	if (!validDate(started) || !validDate(expires)) throw new EmailOperationsFormError('Indicá la fecha de compra y la de vencimiento.');
	if (expires < started) throw new EmailOperationsFormError('El vencimiento no puede ser anterior a la compra.');
	return { expectedRevision: revision, producerEnabled: current.producerEnabled, dailyLimit: current.dailyLimit,
		credit: { messages, startedAt: `${started}T00:00:00${OPERATOR_OFFSET}`, expiresAt: `${expires}T23:59:59${OPERATOR_OFFSET}` }, liftPause: false };
};

export const saveEmailOperations = async (admin: CitaSupabaseClient, actorId: string, change: EmailOperationsChange) => {
	const { data, error } = await admin.rpc('operator_set_email_operations', {
		p_actor_id: actorId, p_expected_revision: change.expectedRevision, p_producer_enabled: change.producerEnabled,
		p_daily_limit: change.dailyLimit, p_credit_messages: change.credit?.messages ?? null,
		p_credit_started_at: change.credit?.startedAt ?? null, p_credit_expires_at: change.credit?.expiresAt ?? null,
		p_lift_pause: change.liftPause
	});
	if (error) throw error;
	return parseEmailOperations(data);
};

export const emailOperationsErrorKind = (cause: unknown) => {
	const message = cause instanceof Error ? cause.message : isRecord(cause) && typeof cause.message === 'string' ? cause.message : '';
	if (/\bEMAIL_OPERATIONS_CHANGED\b/.test(message)) return 'changed' as const;
	if (/\bEMAIL_OPERATIONS_INVALID\b/.test(message)) return 'invalid' as const;
	return 'unknown' as const;
};

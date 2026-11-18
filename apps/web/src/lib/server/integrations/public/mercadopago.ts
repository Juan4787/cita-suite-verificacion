import { isUuid } from '@cita-suite/shared/uuid';
import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import type { CitaSupabaseClient } from '$lib/types/database';
import { hmacSha256HexMatches } from '$lib/server/platform/hmac';
import { readJson, readRecord, readArray, readText, readBoolean, readFiniteNumber, InvalidDataContractError } from '$lib/contracts/json';

export const MP_API_BASE = 'https://api.mercadopago.com';

// Duración declarada de cada cobro mensual aprobado (unidad 'month'). Desde la migración
// 20261118010000, grant_business_access acredita un mes calendario por cobro automático: este valor
// queda en el asiento como duración declarada, que la idempotencia compara.
export const SUBSCRIPTION_DURATION_SECONDS = 30 * 24 * 60 * 60;

export const MP_PAYMENT_IDEMPOTENCY_PREFIX = 'mp:payment:';

// Ventana de frescura del ts de la firma. Mercado Pago reintenta cada 15 minutos y después espacia
// los reintentos; no está documentado si cada reintento lleva una marca nueva. Con 10 minutos, un
// reintento con la marca original se rechazaba siempre. Repetir un aviso legítimo no tiene efecto,
// porque procesar es idempotente y siempre vuelve a consultar a Mercado Pago: la ventana sólo acota
// cuánto tiempo sirve un aviso capturado.
export const SIGNATURE_TS_TOLERANCE_SECONDS = 24 * 60 * 60;

type FetchLike = typeof fetch;


// ---------------------------------------------------------------------------
// Firma x-signature
// ---------------------------------------------------------------------------

export type MpSignatureParts = { ts: string; v1: string };

export const parseSignatureHeader = (header: string | null): MpSignatureParts | null => {
	if (!header) return null;
	const parts: Record<string, string> = {};
	for (const segment of header.split(',')) {
		const eq = segment.indexOf('=');
		if (eq <= 0) continue;
		const key = segment.slice(0, eq).trim();
		const value = segment.slice(eq + 1).trim();
		if (key && value) parts[key] = value;
	}
	if (!parts.ts || !parts.v1) return null;
	return { ts: parts.ts, v1: parts.v1 };
};

// Manifest oficial: `id:[data.id];request-id:[x-request-id];ts:[ts];`.
// Los segmentos cuyo valor no llegó se omiten enteros, y data.id alfanumérico
// se usa en minúsculas.
export const buildSignatureManifest = (opts: {
	dataId: string | null;
	requestId: string | null;
	ts: string;
}): string => {
	const segments: string[] = [];
	const dataId = opts.dataId?.trim();
	const requestId = opts.requestId?.trim();
	if (dataId) segments.push(`id:${dataId.toLowerCase()};`);
	if (requestId) segments.push(`request-id:${requestId};`);
	segments.push(`ts:${opts.ts};`);
	return segments.join('');
};

// MP manda el ts en segundos (10 dígitos) o milisegundos (13) según el
// producto; se normaliza a ms y se exige que esté dentro de la tolerancia.
const isSignatureTimestampFresh = (ts: string, nowMs: number): boolean => {
	if (!/^\d{10,13}$/.test(ts)) return false;
	const tsMs = ts.length >= 13 ? Number(ts) : Number(ts) * 1000;
	return Math.abs(nowMs - tsMs) <= SIGNATURE_TS_TOLERANCE_SECONDS * 1000;
};

export const verifyMpWebhookSignature = (
	opts: {
		signatureHeader: string | null;
		requestId: string | null;
		dataId: string | null;
	},
	nowMs: number = Date.now()
): boolean => {
	const secret = env.MP_WEBHOOK_SECRET?.trim();
	// Falla-cerrado: el webhook es público y se procesa con cliente admin; sin
	// secret configurado no se puede verificar, así que se rechaza todo.
	if (!secret) return false;
	const parts = parseSignatureHeader(opts.signatureHeader);
	if (!parts) return false;
	if (!isSignatureTimestampFresh(parts.ts, nowMs)) return false;
	const manifest = buildSignatureManifest({
		dataId: opts.dataId,
		requestId: opts.requestId,
		ts: parts.ts
	});
	return hmacSha256HexMatches(secret, manifest, parts.v1);
};

// ---------------------------------------------------------------------------
// Cliente API de Mercado Pago
// ---------------------------------------------------------------------------

// `error` trae el motivo que da Mercado Pago cuando rechaza un pedido («User bad request», «Invalid
// value for limit»...): sin él, un rechazo quedaba registrado sólo con su código de estado.
export type MpApiError = { message: string | null; error: string | null };
export type MpApiResult<T> = { ok: boolean; status: number; data: T | null; error?: MpApiError };

const providerError = (payload: unknown): MpApiError | undefined => {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
	const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null);
	const row = payload as Record<string, unknown>;
	const result = { message: text(row.message), error: text(row.error) };
	return result.message || result.error ? result : undefined;
};

const mpResult = async <T>(response: Response, decode: (value: unknown) => T): Promise<MpApiResult<T>> => {
	let data: T | null = null;
	let error: MpApiError | undefined;
	try {
		const payload: unknown = await response.json();
		if (response.ok) data = decode(payload);
		else error = providerError(payload);
	} catch {
		data = null;
	}
	return { ok: response.ok && data !== null, status: response.status, data, ...(error ? { error } : {}) };
};

const mpGet = async <T>(path: string, fetchFn: FetchLike, decode: (value: unknown) => T): Promise<MpApiResult<T>> => {
	const token = env.MP_ACCESS_TOKEN?.trim();
	if (!token) {
		throw new Error('Falta configurar MP_ACCESS_TOKEN.');
	}
	const response = await fetchFn(`${MP_API_BASE}${path}`, {
		headers: { Authorization: `Bearer ${token}` },
		// Presupuesto acotado: la función serverless puede
		// necesitar hasta dos llamadas a MP más las queries a Supabase.
		signal: AbortSignal.timeout(5000)
	});
	return mpResult(response, decode);
};

export type MpPayment = {
	id: number | string;
	status?: string;
	status_detail?: string;
	external_reference?: string | null;
	transaction_amount?: number | null;
	currency_id?: string | null;
	metadata?: Record<string, unknown> | null;
	live_mode?: boolean;
	transaction_amount_refunded?: number | null;
	// Un pago generado por una suscripción trae point_of_interaction.type = 'SUBSCRIPTIONS' y
	// transaction_data.subscription_id = la suscripción (medido el 18-nov-2026).
	point_of_interaction_type?: string | null;
	subscription_id?: string | null;
};

export type MpAuthorizedPayment = {
	id: number | string;
	preapproval_id?: string | null;
	status?: string;
	transaction_amount?: number | null;
	currency_id?: string | null;
	external_reference?: string | null;
	debit_date?: string | null;
	date_created?: string | null;
	last_modified?: string | null;
	retry_attempt?: number | null;
	next_retry_date?: string | null;
	payment?: { id?: number | string; status?: string; status_detail?: string } | null;
};

export type MpPreapproval = {
	id: string;
	status?: string;
	external_reference?: string | null;
	payer_email?: string | null;
	next_payment_date?: string | null;
	init_point?: string | null;
	auto_recurring?: {
		transaction_amount?: number | null;
		currency_id?: string | null;
	} | null;
};

const optionalText = (value: unknown, key: string) => value == null ? value : readText(value, 'mercadoPago.' + key);
const optionalNumber = (value: unknown, key: string) => value == null ? value : readFiniteNumber(value, 'mercadoPago.' + key);
function providerId(value: unknown): string | number {
	if (typeof value === 'string' && value) return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	throw new InvalidDataContractError('mercadoPago.id');
}
function paymentFields(row: Record<string, unknown>) {
	return { id: providerId(row.id), status: row.status == null ? undefined : readText(row.status, 'mercadoPago.status'),
		external_reference: optionalText(row.external_reference, 'reference'), transaction_amount: optionalNumber(row.transaction_amount, 'amount'),
		currency_id: optionalText(row.currency_id, 'currency') };
}
function parseMpPayment(value: unknown): MpPayment {
	const row = readRecord(value, 'mercadoPago.payment');
	const poi = row.point_of_interaction == null ? null : readRecord(row.point_of_interaction, 'mercadoPago.pointOfInteraction');
	const transaction = poi?.transaction_data == null ? null : readRecord(poi.transaction_data, 'mercadoPago.transactionData');
	return { ...paymentFields(row), status_detail: row.status_detail == null ? undefined : readText(row.status_detail, 'mercadoPago.statusDetail'),
		metadata: row.metadata == null ? row.metadata : readRecord(row.metadata, 'mercadoPago.metadata'),
		live_mode: row.live_mode === undefined ? undefined : readBoolean(row.live_mode, 'mercadoPago.liveMode'),
		transaction_amount_refunded: optionalNumber(row.transaction_amount_refunded, 'refunded'),
		point_of_interaction_type: poi === null ? null : optionalText(poi.type, 'pointOfInteractionType'),
		subscription_id: transaction === null ? null : optionalText(transaction.subscription_id, 'subscriptionId') };
}
function parseMpAuthorizedPayment(value: unknown): MpAuthorizedPayment {
	const row = readRecord(value, 'mercadoPago.authorizedPayment');
	const nested = row.payment == null ? null : readRecord(row.payment, 'mercadoPago.nestedPayment');
	return { ...paymentFields(row), preapproval_id: optionalText(row.preapproval_id, 'preapprovalId'),
		debit_date: optionalText(row.debit_date, 'debitDate'), date_created: optionalText(row.date_created, 'dateCreated'),
		last_modified: optionalText(row.last_modified, 'lastModified'), retry_attempt: optionalNumber(row.retry_attempt, 'retryAttempt'),
		next_retry_date: optionalText(row.next_retry_date, 'nextRetryDate'),
		payment: nested === null ? null : { id: nested.id === undefined ? undefined : providerId(nested.id),
			status: nested.status == null ? undefined : readText(nested.status, 'mercadoPago.nestedStatus'),
			status_detail: nested.status_detail == null ? undefined : readText(nested.status_detail, 'mercadoPago.nestedDetail') } };
}
function parseMpPreapproval(value: unknown): MpPreapproval {
	const row = readRecord(value, 'mercadoPago.preapproval');
	const recurring = row.auto_recurring == null ? null : readRecord(row.auto_recurring, 'mercadoPago.recurring');
	return { id: readText(row.id, 'mercadoPago.preapproval.id'),
		status: row.status == null ? undefined : readText(row.status, 'mercadoPago.status'),
		external_reference: optionalText(row.external_reference, 'reference'), payer_email: optionalText(row.payer_email, 'email'),
		next_payment_date: optionalText(row.next_payment_date, 'nextDate'), init_point: optionalText(row.init_point, 'initPoint'),
		auto_recurring: recurring === null ? null : { transaction_amount: optionalNumber(recurring.transaction_amount, 'amount'), currency_id: optionalText(recurring.currency_id, 'currency') } };
}

export const getPayment = (id: string, fetchFn: FetchLike) =>
	mpGet(`/v1/payments/${encodeURIComponent(id)}`, fetchFn, parseMpPayment);

export const getAuthorizedPayment = (id: string, fetchFn: FetchLike) =>
	mpGet(`/authorized_payments/${encodeURIComponent(id)}`, fetchFn, parseMpAuthorizedPayment);

export const getPreapproval = (id: string, fetchFn: FetchLike) =>
	mpGet(`/preapproval/${encodeURIComponent(id)}`, fetchFn, parseMpPreapproval);

// Contrato medido contra Mercado Pago el 18-nov-2026 (docs/plans/cobros-mercadopago-20261118.md,
// sección 5): la búsqueda admite como máximo 15 resultados por página (16 o más responde 400
// «Invalid value for limit»), sin límite trae 12, y pagina con offset y paging.total. Hasta esa
// fecha se pedían 50 y la búsqueda fallaba siempre. El orden no está documentado: se recorren todas
// las páginas, con un tope de 12 (180 cobros, 15 años de una suscripción mensual).
export const MP_AUTHORIZED_PAYMENTS_PAGE_LIMIT = 15;
export const MP_AUTHORIZED_PAYMENTS_MAX_PAGES = 12;

export type MpAuthorizedPaymentsSearch = { results: MpAuthorizedPayment[]; complete: boolean };

const decodeAuthorizedPaymentsPage = (value: unknown) => {
	const row = readRecord(value, 'mercadoPago.search');
	const paging = row.paging == null ? null : readRecord(row.paging, 'mercadoPago.paging');
	return {
		results: row.results === undefined ? [] : readArray(row.results, 'mercadoPago.results').map(parseMpAuthorizedPayment),
		total: paging?.total == null ? undefined : readFiniteNumber(paging.total, 'mercadoPago.paging.total')
	};
};

// Sin la primera página no hay nada que revisar: falla. Una página posterior que falla, o una que el
// presupuesto no admite (`admitsPage`), deja lo leído marcado incompleto, porque acreditar es idempotente
// y lo que falte se revisa en la próxima pasada.
export const searchAuthorizedPayments = async (
	preapprovalId: string,
	fetchFn: FetchLike,
	opts?: { admitsPage?: () => boolean }
): Promise<MpApiResult<MpAuthorizedPaymentsSearch>> => {
	const results: MpAuthorizedPayment[] = [];
	for (let page = 0; page < MP_AUTHORIZED_PAYMENTS_MAX_PAGES; page += 1) {
		if (page > 0 && opts?.admitsPage && !opts.admitsPage()) {
			return { ok: true, status: 200, data: { results, complete: false } };
		}
		const { ok, status, data } = await mpGet(
			`/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}&limit=${MP_AUTHORIZED_PAYMENTS_PAGE_LIMIT}&offset=${results.length}`,
			fetchFn,
			decodeAuthorizedPaymentsPage
		);
		if (!ok || !data) {
			return page === 0 ? { ok: false, status, data: null } : { ok: true, status, data: { results, complete: false } };
		}
		results.push(...data.results);
		if (data.results.length < MP_AUTHORIZED_PAYMENTS_PAGE_LIMIT || (data.total !== undefined && results.length >= data.total)) {
			return { ok: true, status, data: { results, complete: true } };
		}
	}
	return { ok: true, status: 200, data: { results, complete: false } };
};

const mpSend = async <T>(
	method: 'POST' | 'PUT',
	path: string,
	body: Record<string, unknown>,
	fetchFn: FetchLike,
	decode: (value: unknown) => T
): Promise<MpApiResult<T>> => {
	const token = env.MP_ACCESS_TOKEN?.trim();
	if (!token) {
		throw new Error('Falta configurar MP_ACCESS_TOKEN.');
	}
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json'
	};
	if (method === 'POST') {
		headers['X-Idempotency-Key'] = globalThis.crypto.randomUUID();
	}
	const response = await fetchFn(`${MP_API_BASE}${path}`, {
		method,
		headers,
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(8000)
	});
	return mpResult(response, decode);
};

export const MP_SUBSCRIPTION_REASON = 'Cita Suite — Suscripción mensual';

export type MercadoPagoEnvironment = 'test' | 'production';

export const getMercadoPagoEnvironment = (): MercadoPagoEnvironment => {
	const configured = env.MP_ENVIRONMENT?.trim().toLowerCase();
	if (configured === 'test' || configured === 'production') return configured;
	// Compatibilidad con la credencial de prueba histórica de Suscripciones.
	// Los tokens APP_USR pueden pertenecer a prueba o producción, por eso en
	// ese caso MP_ENVIRONMENT debe configurarse explícitamente.
	return env.MP_ACCESS_TOKEN?.trim().startsWith('TEST-') ? 'test' : 'production';
};

export const getMercadoPagoApiConfigIssue = (): string | null => {
	if (!env.MP_ACCESS_TOKEN?.trim()) return 'MP_ACCESS_TOKEN';
	const configuredEnvironment = env.MP_ENVIRONMENT?.trim().toLowerCase();
	if (!configuredEnvironment && !env.MP_ACCESS_TOKEN.trim().startsWith('TEST-')) {
		return 'MP_ENVIRONMENT';
	}
	if (configuredEnvironment && configuredEnvironment !== 'test' && configuredEnvironment !== 'production') {
		return 'MP_ENVIRONMENT';
	}
	if (getMercadoPagoEnvironment() === 'production' && env.MP_ACCESS_TOKEN.trim().startsWith('TEST-')) {
		return 'MP_ENVIRONMENT';
	}
	return null;
};

// Lo que el panel maestro muestra de la configuración vigente, sin ningún secreto: el 18-nov-2026
// producción usaba credenciales de prueba y nadie podía verlo, porque los valores eran secretos.
export type MercadoPagoConfigSummary = {
	environment: MercadoPagoEnvironment;
	amountArs: number;
	tokenKind: 'TEST-' | 'APP_USR-' | 'otro' | 'sin cargar';
	webhookSecretConfigured: boolean;
	configIssue: string | null;
};

export const getMercadoPagoConfigSummary = (): MercadoPagoConfigSummary => {
	const token = env.MP_ACCESS_TOKEN?.trim() ?? '';
	return {
		environment: getMercadoPagoEnvironment(),
		amountArs: getSubscriptionAmountArs(),
		tokenKind: !token ? 'sin cargar' : token.startsWith('TEST-') ? 'TEST-' : token.startsWith('APP_USR-') ? 'APP_USR-' : 'otro',
		webhookSecretConfigured: Boolean(env.MP_WEBHOOK_SECRET?.trim()),
		configIssue: getMercadoPagoApiConfigIssue()
	};
};

// Precio decidido por Juan el 18 de noviembre de 2026: 90.000 pesos por mes. La variable versionada
// MP_SUBSCRIPTION_AMOUNT_ARS (apps/web/wrangler.jsonc) lo fija; este valor de respaldo evita que una
// variable faltante genere un cobro en cero.
export const DEFAULT_SUBSCRIPTION_AMOUNT_ARS = 90000;

export const getSubscriptionAmountArs = (): number => {
	const parsed = Number(env.MP_SUBSCRIPTION_AMOUNT_ARS?.trim() ?? '');
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SUBSCRIPTION_AMOUNT_ARS;
};

// Mercado Pago exige que en su página de pago se use exactamente el correo enviado como pagador
// («Tu e-mail no coincide con el de la suscripción»), y al crear la suscripción rechaza un correo con
// «+» o de un dominio sin correo («User bad request»): medido el 18-nov-2026
// (docs/plans/cobros-mercadopago-20261118.md, sección 5). Por eso el consultorio escribe el correo de
// su cuenta de Mercado Pago, y se valida antes de pedirle nada a Mercado Pago.
const PAYER_EMAIL_PATTERN = /^[^\s@+]+@[^\s@]+\.[^\s@]+$/;
export const payerEmailIssue = (email: string): string | null => {
	if (!email) return 'Escribí el correo de tu cuenta de Mercado Pago.';
	if (email.includes('+'))
		return 'Mercado Pago no acepta correos con «+». Escribí el correo de tu cuenta de Mercado Pago sin el «+» ni lo que le sigue.';
	if (email.length > 254 || !PAYER_EMAIL_PATTERN.test(email)) return 'Revisá el correo: no parece una dirección válida.';
	return null;
};

// Los motivos con que Mercado Pago rechaza el correo del pagador al crear la suscripción.
export const isPayerRejection = (result: MpApiResult<unknown>) =>
	result.status === 400 &&
	['User bad request', 'Payer is associated with a different site'].includes(result.error?.message ?? '');

// Preapproval "sin plan asociado": el cliente autoriza una vez en Mercado Pago
// (redirect a init_point) y MP cobra solo cada mes. Sin prueba gratuita y sin
// exclusiones de medios de pago: MP muestra lo que la cuenta tenga habilitado.
export const createPreapproval = (
	fetchFn: FetchLike,
	opts: { businessId: string; payerEmail: string; amount: number; backUrl: string }
) =>
	mpSend<MpPreapproval>(
		'POST',
		'/preapproval',
		{
			reason: MP_SUBSCRIPTION_REASON,
			external_reference: opts.businessId,
			payer_email: opts.payerEmail,
			back_url: opts.backUrl,
			auto_recurring: {
				frequency: 1,
				frequency_type: 'months',
				transaction_amount: opts.amount,
				currency_id: 'ARS'
			},
			status: 'pending'
		},
		fetchFn, parseMpPreapproval
	);

export const cancelPreapproval = (fetchFn: FetchLike, preapprovalId: string) =>
	mpSend<MpPreapproval>(
		'PUT',
		`/preapproval/${encodeURIComponent(preapprovalId)}`,
		{ status: 'cancelled' },
		fetchFn, parseMpPreapproval
	);

// ---------------------------------------------------------------------------
// Acreditación en el ledger
// ---------------------------------------------------------------------------

export type CreditOutcome =
	| {
			kind: 'credited' | 'duplicated';
			grantId: string | null;
			statusAfter: string | null;
	  }
	| {
			kind: 'skipped';
			reason: 'unknown_business' | 'permanent_business';
	  };

const businessExists = async (admin: CitaSupabaseClient, businessId: string): Promise<boolean> => {
	const { data, error } = await admin
		.from('businesses')
		.select('id')
		.eq('id', businessId)
		.maybeSingle()
		.retry(false);
	if (error) {
		throw new Error(`No se pudo verificar el negocio ${businessId}: ${error.message}`);
	}
	return Boolean(data);
};

const businessIsPermanent = async (
	admin: CitaSupabaseClient,
	businessId: string
): Promise<boolean> => {
	const { data, error } = await admin
		.from('business_subscriptions')
		.select('is_permanent')
		.eq('business_id', businessId)
		.maybeSingle()
		.retry(false);
	if (error) {
		throw new Error(`No se pudo leer la suscripción del negocio ${businessId}: ${error.message}`);
	}
	return Boolean(data?.is_permanent);
};

type GrantCallOverrides = {
	businessId: string;
	operation: 'payment_registered' | 'payment_cancelled';
	durationSeconds: number | null;
	durationUnit: string | null;
	amount: number | null;
	note: string;
	idempotencyKey: string;
};

const callGrantAccess = async (admin: CitaSupabaseClient, opts: GrantCallOverrides) => {
	const { data, error } = await admin.rpc('grant_business_access', {
		p_business_id: opts.businessId,
		p_operation: opts.operation,
		p_duration_seconds: opts.durationSeconds,
		p_duration_unit: opts.durationUnit,
		p_is_permanent: false,
		p_amount: opts.amount,
		p_source: 'mercado_pago',
		p_note: opts.note,
		p_admin_id: null,
		p_admin_email: null,
		p_idempotency_key: opts.idempotencyKey
	});
	if (error) {
		throw new Error(`grant_business_access (${opts.operation}) falló: ${error.message}`);
	}
	const row = Array.isArray(data) ? data[0] : data;
	return {
		applied: Boolean(row?.applied),
		grantId: row?.grant_id ?? null,
		statusAfter: row?.status_after ?? null
	};
};

// Acredita un mes por un pago aprobado (grant_business_access, unidad 'month'). Idempotente: la clave
// `mp:payment:{id}` hace que webhook, retorno del checkout y conciliación
// puedan intentarlo sin duplicar. Pre-chequea existencia y permanencia del
// negocio para que un mapeo roto o un negocio permanente no terminen en un
// loop de reintentos de MP (la RPC sigue de guardia ante carreras).
export const creditApprovedPayment = async (
	admin: CitaSupabaseClient,
	opts: { businessId: string; paymentId: string; amount: number | null; origin: string }
): Promise<CreditOutcome> => {
	if (!(await businessExists(admin, opts.businessId))) {
		return { kind: 'skipped', reason: 'unknown_business' };
	}
	if (await businessIsPermanent(admin, opts.businessId)) {
		return { kind: 'skipped', reason: 'permanent_business' };
	}
	const result = await callGrantAccess(admin, {
		businessId: opts.businessId,
		operation: 'payment_registered',
		durationSeconds: SUBSCRIPTION_DURATION_SECONDS,
		durationUnit: 'month',
		amount: opts.amount,
		// La nota la ve el consultorio en su historial: sin el camino técnico, que queda en mp_webhook_events.
		note: `Pago de Mercado Pago ${opts.paymentId} acreditado automáticamente.`,
		idempotencyKey: `${MP_PAYMENT_IDEMPOTENCY_PREFIX}${opts.paymentId}`
	});
	return {
		kind: result.applied ? 'credited' : 'duplicated',
		grantId: result.grantId,
		statusAfter: result.statusAfter
	};
};

// Registra en el ledger un reembolso/contracargo sin tocar el acceso: la
// decisión de reducir o cortar queda en manos del admin (requires_attention).
export const recordCancelledPayment = async (
	admin: CitaSupabaseClient,
	opts: { businessId: string; paymentId: string; amount: number | null; status: string }
): Promise<CreditOutcome> => {
	if (!(await businessExists(admin, opts.businessId))) {
		return { kind: 'skipped', reason: 'unknown_business' };
	}
	const result = await callGrantAccess(admin, {
		businessId: opts.businessId,
		operation: 'payment_cancelled',
		durationSeconds: null,
		durationUnit: null,
		amount: opts.amount,
		note: `Pago de Mercado Pago ${opts.paymentId} pasó a estado "${opts.status}". El acceso no se modificó automáticamente; revisar y decidir manualmente.`,
		idempotencyKey: `${MP_PAYMENT_IDEMPOTENCY_PREFIX}${opts.paymentId}:cancelled`
	});
	return {
		kind: result.applied ? 'credited' : 'duplicated',
		grantId: result.grantId,
		statusAfter: result.statusAfter
	};
};

// ---------------------------------------------------------------------------
// Sincronización de mp_subscriptions
// ---------------------------------------------------------------------------

export const upsertMpSubscription = async (
	admin: CitaSupabaseClient,
	preapproval: MpPreapproval
): Promise<{ businessId: string | null; detail: string }> => {
	const businessId = preapproval.external_reference?.trim() ?? '';
	if (!isUuid(businessId)) {
		return {
			businessId: null,
			detail: `Preapproval ${preapproval.id} sin external_reference válido (business_id).`
		};
	}
	if (!(await businessExists(admin, businessId))) {
		return {
			businessId: null,
			detail: `Preapproval ${preapproval.id} referencia un negocio inexistente (${businessId}).`
		};
	}
	const { error } = await admin.from('mp_subscriptions').upsert(
		{
			business_id: businessId,
			preapproval_id: preapproval.id,
			status: preapproval.status ?? 'pending',
			payer_email: preapproval.payer_email ?? null,
			transaction_amount: preapproval.auto_recurring?.transaction_amount ?? null,
			currency_id: preapproval.auto_recurring?.currency_id ?? null,
			next_charge_at: preapproval.next_payment_date ?? null,
			last_synced_at: new Date().toISOString(),
			raw: preapproval
		},
		{ onConflict: 'preapproval_id' }
	);
	if (error) {
		throw new Error(`No se pudo guardar mp_subscriptions: ${error.message}`);
	}

	// Doble débito: dos POST concurrentes de subscribe pueden crear dos
	// pendings que se autorizan ambos (el guard del action solo ve
	// authorized/paused ya existentes). Todos los caminos de sincronización
	// pasan por acá, así que la condición se detecta apenas la segunda queda
	// autorizada y se alerta UNA vez por negocio.
	if ((preapproval.status ?? 'pending') === 'authorized') {
		const { data: dupRows, error: dupError } = await admin
			.from('mp_subscriptions')
			.select('preapproval_id')
			.eq('business_id', businessId)
			.eq('status', 'authorized')
			.limit(2)
			.retry(false);
		if (dupError) {
			// The check repeats on every sync; a failure must not switch it off silently.
			logServerFailure('No se pudo comprobar si hay otra suscripción autorizada', dupError);
		} else if ((dupRows ?? []).length > 1) {
			await logMpWebhookEventOnce(admin, {
				topic: 'duplicate_subscription',
				action: 'duplicate_authorized',
				resource_id: businessId,
				request_id: null,
				live_mode: null,
				signature_valid: true,
				processing_status: 'processed',
				processing_detail:
					'Hay más de una suscripción AUTORIZADA para el mismo negocio: se está debitando más de una vez por mes. Cancelar la duplicada en Mercado Pago y evaluar reembolso.',
				business_id: businessId,
				requires_attention: true
			});
		}
	}

	return {
		businessId,
		detail: `Suscripción ${preapproval.id} sincronizada (${preapproval.status ?? 'pending'}).`
	};
};

const findBusinessByPreapproval = async (
	admin: CitaSupabaseClient,
	preapprovalId: string
): Promise<string | null> => {
	const { data, error } = await admin
		.from('mp_subscriptions')
		.select('business_id')
		.eq('preapproval_id', preapprovalId)
		.maybeSingle();
	if (error) {
		throw new Error(`No se pudo buscar la suscripción ${preapprovalId}: ${error.message}`);
	}
	return data?.business_id ?? null;
};

// ---------------------------------------------------------------------------
// Procesamiento de eventos (webhook / conciliación comparten esta lógica)
// ---------------------------------------------------------------------------

export type MpProcessResult = {
	status: 'processed' | 'skipped' | 'error';
	detail: string;
	businessId: string | null;
	grantId: string | null;
	requiresAttention: boolean;
};

// Estados de acceso que, tras acreditar un pago, significan "el cliente pagó
// pero sigue bloqueado" (kill-switch manual, archivado o alta sin configurar).
// Es el único escenario nuevo que crea la regla "lo manual gana": siempre se
// marca para revisión.
const BLOCKED_STATUSES = new Set(['restricted', 'archived']);

// Solo reembolsos y contracargos ameritan asiento y aviso. Un pago 'cancelled'
// nunca estuvo aprobado (pending que expiró, checkout abandonado): registrarlo
// generaría alertas falsas.
const CANCELLED_PAYMENT_STATUSES = new Set(['refunded', 'charged_back']);

// Fallo de la API de MP: los transitorios (5xx/429) se devuelven como 'error'
// para que el webhook responda 500 y MP reintente; un 4xx definitivo se salta
// pero queda marcado (suele ser credenciales test/prod cruzadas).
const apiFailureResult = (httpStatus: number, what: string): MpProcessResult => {
	const transient = httpStatus >= 500 || httpStatus === 429;
	return {
		status: transient ? 'error' : 'skipped',
		detail: `La API de MP no devolvió ${what} (HTTP ${httpStatus}).${
			transient ? ' Se pedirá reintento.' : ''
		}`,
		businessId: null,
		grantId: null,
		requiresAttention: !transient
	};
};

const creditOutcomeResult = (
	outcome: CreditOutcome,
	businessId: string,
	what: string
): MpProcessResult => {
	if (outcome.kind === 'skipped') {
		return {
			status: 'skipped',
			detail:
				outcome.reason === 'unknown_business'
					? `${what} aprobado pero el negocio ${businessId} no existe en la base; no se acredita.`
					: `${what} aprobado sobre un negocio permanente; no se acredita duración. Revisar la suscripción MP.`,
			businessId: null,
			grantId: null,
			requiresAttention: true
		};
	}
	const blocked = outcome.statusAfter !== null && BLOCKED_STATUSES.has(outcome.statusAfter);
	const base = outcome.kind === 'duplicated' ? `${what} ya estaba acreditado (idempotente).` : `${what} acreditado: +1 mes.`;
	return {
		status: 'processed',
		detail: blocked
			? `${base} ATENCIÓN: el negocio queda "${outcome.statusAfter}" (override manual o alta sin configurar); el pago se registró pero el acceso sigue bloqueado.`
			: base,
		businessId,
		grantId: outcome.grantId,
		requiresAttention: blocked
	};
};

const resolvePaymentBusinessId = (payment: MpPayment): string | null => {
	const external = payment.external_reference?.trim();
	if (isUuid(external)) return external;
	const metaBusiness = payment.metadata?.business_id;
	if (isUuid(metaBusiness)) return metaBusiness;
	return null;
};

// Un aviso con atención que se registra una sola vez por recurso mientras siga sin resolver.
const attentionOnce = (
	admin: CitaSupabaseClient,
	opts: { topic: string; action: string; resourceId: string; businessId: string | null; detail: string }
) =>
	logMpWebhookEventOnce(admin, {
		topic: opts.topic,
		action: opts.action,
		resource_id: opts.resourceId,
		request_id: null,
		live_mode: null,
		signature_valid: true,
		processing_status: 'processed',
		processing_detail: opts.detail,
		business_id: opts.businessId,
		requires_attention: true
	});

// El consultorio de una suscripción: el vínculo local o, si falta, el que se reconstruye desde
// Mercado Pago (external_reference), que queda guardado para la próxima.
const subscriptionBusinessOf = async (
	admin: CitaSupabaseClient,
	fetchFn: FetchLike,
	preapprovalId: string
): Promise<string | null> => {
	const mapped = await findBusinessByPreapproval(admin, preapprovalId);
	if (mapped) return mapped;
	const { ok, data } = await getPreapproval(preapprovalId, fetchFn);
	if (!ok || !data) return null;
	return (await upsertMpSubscription(admin, data)).businessId;
};

const processPaymentTopic = async (
	admin: CitaSupabaseClient,
	fetchFn: FetchLike,
	resourceId: string,
	origin: string
): Promise<MpProcessResult> => {
	const { ok, status, data: payment } = await getPayment(resourceId, fetchFn);
	if (!ok || !payment) {
		return apiFailureResult(status, `el pago ${resourceId}`);
	}

	const referenceBusinessId = resolvePaymentBusinessId(payment);
	const paymentStatus = payment.status ?? 'desconocido';
	const paymentId = String(payment.id);
	const subscriptionId =
		payment.point_of_interaction_type === 'SUBSCRIPTIONS' ? payment.subscription_id?.trim() || null : null;

	if (paymentStatus === 'approved') {
		// Sólo se acredita un pago en pesos de una suscripción conocida del consultorio (hallazgo B3):
		// con la referencia sola, cualquier pago aprobado con el identificador de un consultorio sumaba un mes.
		const unverified = (detail: string, businessId: string | null): MpProcessResult => ({
			status: 'skipped',
			detail,
			businessId,
			grantId: null,
			requiresAttention: true
		});
		if (payment.currency_id && payment.currency_id !== 'ARS') {
			return unverified(`Pago ${resourceId} aprobado en ${payment.currency_id}: sólo se acreditan pagos en pesos. Revisar.`, referenceBusinessId);
		}
		if (!subscriptionId) {
			return unverified(
				`Pago ${resourceId} aprobado que no proviene de una suscripción de Mercado Pago: no se acredita automáticamente. Revisar.`,
				referenceBusinessId
			);
		}
		const subscriptionBusinessId = await subscriptionBusinessOf(admin, fetchFn, subscriptionId);
		if (!subscriptionBusinessId) {
			return unverified(
				`Pago ${resourceId} aprobado de la suscripción ${subscriptionId}, que no corresponde a ningún consultorio. Revisar.`,
				referenceBusinessId
			);
		}
		if (referenceBusinessId && referenceBusinessId !== subscriptionBusinessId) {
			return unverified(
				`Pago ${resourceId} aprobado: su referencia (${referenceBusinessId}) no coincide con el consultorio de la suscripción ${subscriptionId} (${subscriptionBusinessId}). No se acredita. Revisar.`,
				subscriptionBusinessId
			);
		}
		const outcome = await creditApprovedPayment(admin, {
			businessId: subscriptionBusinessId,
			paymentId,
			amount: payment.transaction_amount ?? null,
			origin
		});
		if ((payment.transaction_amount_refunded ?? 0) > 0) {
			await attentionOnce(admin, {
				topic: 'payment',
				action: 'payment_partially_refunded',
				resourceId: paymentId,
				businessId: subscriptionBusinessId,
				detail: `Pago ${resourceId} aprobado con un reembolso parcial de $${payment.transaction_amount_refunded}. El acceso no se modificó: revisar y decidir manualmente.`
			});
		}
		return creditOutcomeResult(outcome, subscriptionBusinessId, `Pago ${resourceId}`);
	}

	const businessId =
		referenceBusinessId ?? (subscriptionId ? await subscriptionBusinessOf(admin, fetchFn, subscriptionId) : null);

	if (paymentStatus === 'in_mediation') {
		await attentionOnce(admin, {
			topic: 'payment',
			action: 'payment_in_mediation',
			resourceId: paymentId,
			businessId,
			detail: `Pago ${resourceId} con una disputa abierta en Mercado Pago. El acceso no se modificó: revisar.`
		});
		return {
			status: 'processed',
			detail: `Pago ${resourceId} en disputa; aviso registrado.`,
			businessId,
			grantId: null,
			requiresAttention: false
		};
	}

	if (CANCELLED_PAYMENT_STATUSES.has(paymentStatus)) {
		if (!businessId) {
			return {
				status: 'skipped',
				detail: `Pago ${resourceId} en estado ${paymentStatus} sin negocio mapeable.`,
				businessId: null,
				grantId: null,
				requiresAttention: true
			};
		}
		const outcome = await recordCancelledPayment(admin, {
			businessId,
			paymentId: String(payment.id),
			amount: payment.transaction_amount ?? null,
			status: paymentStatus
		});
		if (outcome.kind === 'skipped') {
			return creditOutcomeResult(outcome, businessId, `Pago ${resourceId}`);
		}
		return {
			status: 'processed',
			detail: `Pago ${resourceId} en estado ${paymentStatus}; registrado en el ledger, acceso sin cambios. Revisar.`,
			businessId,
			grantId: outcome.grantId,
			requiresAttention: true
		};
	}

	return {
		status: 'skipped',
		detail: `Pago ${resourceId} en estado ${paymentStatus}; no requiere acción.`,
		businessId,
		grantId: null,
		requiresAttention: false
	};
};

// Un cobro rechazado o en reintento: Mercado Pago reintenta hasta 4 veces en 10 días y, después de 3
// cuotas rechazadas, cancela la suscripción (documentación oficial, leída el 18-nov-2026).
const isRejectedCharge = (charge: MpAuthorizedPayment) =>
	charge.payment?.status === 'rejected' || charge.status === 'recycling';

const chargeRejectedDetail = (charge: MpAuthorizedPayment, preapprovalId: string) =>
	`Mercado Pago no pudo cobrar la cuota ${charge.id} de la suscripción ${preapprovalId || 'desconocida'}` +
	(charge.payment?.status_detail ? ` (${charge.payment.status_detail})` : '') +
	'. Reintenta hasta 4 veces en 10 días' +
	(charge.next_retry_date ? `; próximo intento: ${charge.next_retry_date}` : '') +
	'. Si sigue fallando, el consultorio tiene que actualizar su medio de pago en Mercado Pago; tras 3 cuotas rechazadas, Mercado Pago cancela la suscripción.';

// El último cobro de una suscripción, para avisar en su página cuando Mercado Pago no pudo cobrar.
// Los avisos pueden llegar desordenados: se guarda sólo si no es anterior al que ya está.
const recordLastCharge = async (admin: CitaSupabaseClient, preapprovalId: string, charge: MpAuthorizedPayment) => {
	const moment = charge.debit_date ?? charge.date_created;
	const parsed = moment ? Date.parse(moment) : Number.NaN;
	const at = new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
	const { error } = await admin
		.from('mp_subscriptions')
		.update({
			last_charge_id: String(charge.id),
			last_charge_status: charge.payment?.status ?? charge.status ?? null,
			last_charge_detail: charge.payment?.status_detail ?? null,
			last_charge_at: at
		})
		.eq('preapproval_id', preapprovalId)
		.or(`last_charge_at.is.null,last_charge_at.lte."${at}"`);
	if (error) logServerFailure('No se pudo guardar el último cobro de la suscripción', error);
};

const processAuthorizedPaymentTopic = async (
	admin: CitaSupabaseClient,
	fetchFn: FetchLike,
	resourceId: string,
	origin: string
): Promise<MpProcessResult> => {
	const { ok, status, data: authorized } = await getAuthorizedPayment(resourceId, fetchFn);
	if (!ok || !authorized) {
		return apiFailureResult(status, `el cobro de suscripción ${resourceId}`);
	}

	const preapprovalId = authorized.preapproval_id?.trim() ?? '';
	// Sin vínculo local, se reconstruye desde el preapproval (external_reference) y queda guardado.
	let businessId = preapprovalId ? await subscriptionBusinessOf(admin, fetchFn, preapprovalId) : null;

	if (!businessId && isUuid(authorized.external_reference?.trim())) {
		businessId = authorized.external_reference!.trim();
	}

	const paymentId = authorized.payment?.id != null ? String(authorized.payment.id) : null;
	const paymentStatus = authorized.payment?.status ?? authorized.status ?? 'desconocido';
	if (preapprovalId) await recordLastCharge(admin, preapprovalId, authorized);

	if (paymentStatus === 'approved') {
		if (!businessId || !paymentId) {
			return {
				status: 'skipped',
				detail: !paymentId
					? `Cobro de suscripción ${resourceId} aprobado pero sin id de pago en la respuesta de MP; revisar manualmente (preapproval ${preapprovalId || 'desconocido'}).`
					: `Cobro de suscripción ${resourceId} aprobado pero sin negocio mapeable (preapproval ${preapprovalId || 'desconocido'}).`,
				businessId: null,
				grantId: null,
				requiresAttention: true
			};
		}
		const outcome = await creditApprovedPayment(admin, {
			businessId,
			paymentId,
			amount: authorized.transaction_amount ?? null,
			origin
		});
		return creditOutcomeResult(outcome, businessId, `Cobro ${resourceId} (pago ${paymentId})`);
	}

	if (isRejectedCharge(authorized)) {
		// Una alerta por cuota, no por reintento: cada reintento manda otro aviso del mismo cobro.
		await attentionOnce(admin, {
			topic: 'subscription_charge',
			action: 'charge_rejected',
			resourceId: String(authorized.id),
			businessId,
			detail: chargeRejectedDetail(authorized, preapprovalId)
		});
	}

	return {
		status: 'skipped',
		detail: `Cobro de suscripción ${resourceId} en estado ${paymentStatus}; no requiere acción.`,
		businessId,
		grantId: null,
		requiresAttention: false
	};
};

const ATTENTION_PREAPPROVAL_STATUSES = new Set(['cancelled', 'paused']);

const processPreapprovalTopic = async (
	admin: CitaSupabaseClient,
	fetchFn: FetchLike,
	resourceId: string
): Promise<MpProcessResult> => {
	const { ok, status, data: preapproval } = await getPreapproval(resourceId, fetchFn);
	if (!ok || !preapproval) {
		return apiFailureResult(status, `el preapproval ${resourceId}`);
	}
	const upsert = await upsertMpSubscription(admin, preapproval);
	if (!upsert.businessId) {
		return {
			status: 'skipped',
			detail: upsert.detail,
			businessId: null,
			grantId: null,
			requiresAttention: true
		};
	}
	const preStatus = preapproval.status ?? 'pending';
	return {
		status: 'processed',
		detail: upsert.detail,
		businessId: upsert.businessId,
		grantId: null,
		// Cancelada/pausada: el acceso vigente se agota solo, pero conviene
		// enterarse (el cliente dejó de pagar).
		requiresAttention: ATTENTION_PREAPPROVAL_STATUSES.has(preStatus)
	};
};

export const processMpWebhookEvent = async (
	admin: CitaSupabaseClient,
	fetchFn: FetchLike,
	opts: { topic: string | null; resourceId: string | null; origin?: string }
): Promise<MpProcessResult> => {
	const topic = opts.topic?.trim().toLowerCase() ?? '';
	const resourceId = opts.resourceId?.trim() ?? '';
	const origin = opts.origin ?? 'webhook';

	if (!resourceId) {
		return {
			status: 'skipped',
			detail: 'Notificación sin data.id; nada para procesar.',
			businessId: null,
			grantId: null,
			requiresAttention: false
		};
	}

	try {
		if (topic === 'payment') {
			return await processPaymentTopic(admin, fetchFn, resourceId, origin);
		}
		if (topic === 'subscription_authorized_payment') {
			return await processAuthorizedPaymentTopic(admin, fetchFn, resourceId, origin);
		}
		if (topic === 'subscription_preapproval') {
			return await processPreapprovalTopic(admin, fetchFn, resourceId);
		}
		return {
			status: 'skipped',
			detail: `Topic ${topic || 'desconocido'} sin manejador; ignorado.`,
			businessId: null,
			grantId: null,
			requiresAttention: false
		};
	} catch (error) {
		return {
			status: 'error',
			detail: error instanceof Error ? error.message : 'Error desconocido procesando el evento.',
			businessId: null,
			grantId: null,
			requiresAttention: true
		};
	}
};

// ---------------------------------------------------------------------------
// Confirmación activa al volver del checkout (retorno). El redirect JAMÁS
// acredita por sí mismo: acá se consulta a la API de MP el estado real del
// preapproval y sus cobros, y se acredita con las mismas claves idempotentes
// que el webhook. Si el webhook llegó primero, esto es un no-op.
// ---------------------------------------------------------------------------

export type MpReturnSummary = {
	subscriptionStatus: string | null;
	creditedNow: boolean;
	accessBlocked: boolean;
};

// La función serverless tiene un presupuesto acotado: la confirmación deja de
// iterar antes de agotar ese presupuesto y devuelve lo confirmado hasta ahí
// (webhook + conciliación completan lo que falte).
const CONFIRM_BUDGET_MS = 6500;

export const confirmMpSubscriptionForBusiness = async (
	admin: CitaSupabaseClient,
	fetchFn: FetchLike,
	businessId: string
): Promise<MpReturnSummary> => {
	const deadline = Date.now() + CONFIRM_BUDGET_MS;
	const { data: rows, error } = await admin
		.from('mp_subscriptions')
		.select('preapproval_id, status')
		.eq('business_id', businessId)
		.order('created_at', { ascending: false })
		.limit(3);
	if (error) {
		throw new Error(`No se pudieron leer las suscripciones del negocio: ${error.message}`);
	}

	let subscriptionStatus: string | null = null;
	let creditedNow = false;
	let accessBlocked = false;

	for (const row of rows ?? []) {
		if (Date.now() > deadline) break;
		const preapprovalId = row.preapproval_id;
		const { ok, data: preapproval } = await getPreapproval(preapprovalId, fetchFn);
		if (!ok || !preapproval) continue;
		await upsertMpSubscription(admin, preapproval);

		const status = preapproval.status ?? 'pending';
		if (status === 'authorized') {
			subscriptionStatus = 'authorized';
		} else if (!subscriptionStatus) {
			subscriptionStatus = status;
		}
		if (status !== 'authorized') continue;

		const { ok: searchOk, data: page } = await searchAuthorizedPayments(preapprovalId, fetchFn, {
			admitsPage: () => Date.now() <= deadline
		});
		if (searchOk) {
			for (const charge of page?.results ?? []) {
				const paymentId = charge.payment?.id != null ? String(charge.payment.id) : null;
				if (!paymentId || charge.payment?.status !== 'approved') continue;
				const outcome = await creditApprovedPayment(admin, {
					businessId,
					paymentId,
					amount: charge.transaction_amount ?? null,
					origin: 'retorno'
				});
				if (outcome.kind === 'credited') creditedNow = true;
				if (
					outcome.kind !== 'skipped' &&
					outcome.statusAfter !== null &&
					BLOCKED_STATUSES.has(outcome.statusAfter)
				) {
					accessBlocked = true;
				}
			}
		}
		// La suscripción autorizada manda; no hace falta revisar intentos viejos.
		break;
	}

	return { subscriptionStatus, creditedNow, accessBlocked };
};

// Antes de cancelar un preapproval hay que asentar cualquier cobro ya aprobado
// que webhook/retorno no hayan registrado: una vez cancelada, la fila sale del
// filtro de conciliación y ese último mes pagado se perdería. Idempotente.
// La cancelación no espera a este barrido, porque frenarla podría cobrar otro mes:
// si no se pudieron revisar los cobros, queda un evento que requiere atención.
export const settleApprovedChargesForPreapproval = async (
	admin: CitaSupabaseClient,
	fetchFn: FetchLike,
	businessId: string,
	preapprovalId: string
): Promise<{ credited: number; checked: boolean }> => {
	let credited = 0;
	try {
		const { ok, status, data: page } = await searchAuthorizedPayments(preapprovalId, fetchFn);
		if (!ok || !page) throw new Error(`Mercado Pago respondió HTTP ${status} al buscar los cobros.`);
		for (const charge of page.results) {
			const paymentId = charge.payment?.id != null ? String(charge.payment.id) : null;
			if (!paymentId || charge.payment?.status !== 'approved') continue;
			const outcome = await creditApprovedPayment(admin, {
				businessId,
				paymentId,
				amount: charge.transaction_amount ?? null,
				origin: 'cancelación'
			});
			if (outcome.kind === 'credited') credited += 1;
		}
		// Lo encontrado ya quedó asentado; si faltaron páginas, el resto se revisa a mano.
		if (!page.complete) throw new Error('Mercado Pago no devolvió todas las páginas de cobros.');
		return { credited, checked: true };
	} catch (error) {
		logServerFailure('No se pudo asentar el cobro final antes de cancelar', error);
		await logMpWebhookEvent(admin, {
			topic: 'cancellation',
			action: 'final_charges_unchecked',
			resource_id: preapprovalId,
			request_id: null,
			live_mode: null,
			signature_valid: true,
			processing_status: 'error',
			processing_detail:
				'Se canceló la suscripción sin poder revisar sus cobros en Mercado Pago. Revisar si hay un cobro aprobado sin acreditar: después de cancelar, la conciliación ya no la revisa.',
			business_id: businessId,
			requires_attention: true
		});
		return { credited, checked: false };
	}
};

// ---------------------------------------------------------------------------
// Registro de eventos (webhook hoy; conciliación en Fase 3 usa el mismo helper)
// ---------------------------------------------------------------------------

export type MpWebhookEventRow = {
	topic: string | null;
	action: string | null;
	resource_id: string | null;
	request_id: string | null;
	live_mode: boolean | null;
	signature_valid: boolean;
	processing_status: 'received' | 'processed' | 'skipped' | 'rejected' | 'error';
	processing_detail: string;
	business_id?: string | null;
	credited_grant_id?: string | null;
	requires_attention?: boolean;
	raw?: Record<string, unknown> | null;
};

export const logMpWebhookEvent = async (
	admin: CitaSupabaseClient,
	row: MpWebhookEventRow
): Promise<void> => {
	try {
		const { error } = await admin.from('mp_webhook_events').insert({ ...row, raw: readJson(row.raw ?? null, 'paymentWebhook.raw') });
		if (error) console.error('No se pudo registrar el evento de Mercado Pago.');
	} catch {
		// The log must not overturn payment processing, even if optional JSON or
		// the transport fails. Do not include provider bodies in application logs.
		console.error('No se pudo registrar el evento de Mercado Pago.');
	}
};

// Variante idempotente para condiciones PERSISTENTES que se re-detectan en
// cada corrida (negocio permanente con preapproval vivo, mapeo roto, doble
// suscripción): alerta una sola vez por (action, resource_id) para que la
// conciliación de cada 6 h no sepulte las alertas reales bajo repeticiones.
export const logMpWebhookEventOnce = async (
	admin: CitaSupabaseClient,
	row: MpWebhookEventRow & { action: string; resource_id: string }
): Promise<boolean> => {
	// Sólo cuenta un aviso que siga sin resolver: si la condición vuelve después de resolverla (una
	// segunda doble suscripción, un cobro rechazado otra vez), avisa de nuevo.
	const { data: existing, error } = await admin
		.from('mp_webhook_events')
		.select('id')
		.eq('action', row.action)
		.eq('resource_id', row.resource_id)
		.is('resolved_at', null)
		.limit(1)
		.maybeSingle()
		.retry(false);
	if (error) {
		logServerFailure('No se pudo verificar eventos previos de Mercado Pago', error);
		// Ante la duda se loguea igual: mejor una alerta repetida que ninguna.
	}
	if (existing) return false;
	await logMpWebhookEvent(admin, row);
	return true;
};

// ---------------------------------------------------------------------------
// Vista de suscripciones (compartida por la página de suscripción y el panel
// maestro): una autorizada le gana a una pausada, y esa a la más reciente.
// ---------------------------------------------------------------------------

export type MpSubscriptionRow = {
	business_id?: string;
	preapproval_id: string;
	status: string;
	payer_email?: string | null;
	transaction_amount?: number | null;
	next_charge_at?: string | null;
	last_synced_at?: string | null;
	updated_at?: string | null;
};

export const pickRelevantMpSubscription = <T extends { status: string }>(
	rows: T[]
): T | null => {
	if (rows.length === 0) return null;
	return (
		rows.find((row) => row.status === 'authorized') ??
		rows.find((row) => row.status === 'paused') ??
		rows[0]
	);
};

// ---------------------------------------------------------------------------
// Conciliación programada (Fase 3): la red de seguridad definitiva. Recorre
// las suscripciones locales, sincroniza su estado real contra la API de MP y
// acredita cualquier cobro aprobado que webhook/retorno no hayan registrado,
// con las mismas claves idempotentes. Corre por cron (~6 h) y desde el panel
// maestro ("conciliar ahora").
// ---------------------------------------------------------------------------

export type MpReconcileSummary = {
	scanned: number;
	credited: number;
	attention: number;
	errors: number;
	details: string[];
};

const RECONCILE_BUDGET_MS = 6500;
/**
 * Worst case of one subscription before its charges: the preapproval, its sync with
 * the duplicate check and a one-time alert, a status alert, the first page of the charge
 * search, the last charge record, the reversal ledger and the credited ledger. Each extra
 * page, each rejected-charge alert (2) and each new approved or reversed charge (4) is
 * admitted on its own.
 */
export const RECONCILE_SUBSCRIPTION_CALLS = 11;
export const RECONCILE_CHARGE_CALLS = 4;

/** A request nobody completed in this time is cancelled in Mercado Pago (finding M10). */
export const ABANDONED_PENDING_MS = 7 * 24 * 60 * 60 * 1000;
/** Only charges this recent raise a rejected-charge alert: older ones are history, not news. */
const RECENT_CHARGE_MS = 15 * 24 * 60 * 60 * 1000;

const chargeTime = (charge: MpAuthorizedPayment): number | null => {
	const time = Date.parse(charge.debit_date ?? charge.date_created ?? '');
	return Number.isFinite(time) ? time : null;
};
const isRecentCharge = (charge: MpAuthorizedPayment) => {
	const time = chargeTime(charge);
	return time !== null && Date.now() - time <= RECENT_CHARGE_MS;
};
const latestCharge = (charges: MpAuthorizedPayment[]) =>
	charges.reduce<MpAuthorizedPayment | null>(
		(best, charge) => (!best || (chargeTime(charge) ?? -Infinity) >= (chargeTime(best) ?? -Infinity) ? charge : best),
		null
	);

/** Ledger keys that already exist, read in one trip instead of retried one by one. */
const ledgerKeys = async (admin: CitaSupabaseClient, keys: string[]): Promise<Set<string>> => {
	if (!keys.length) return new Set();
	const { data, error } = await admin
		.from('access_grants')
		.select('idempotency_key')
		.in('idempotency_key', keys)
		.retry(false);
	if (error) throw new Error(`No se pudieron leer los asientos: ${error.message}`);
	return new Set(data.map((row) => row.idempotency_key));
};

/** Payments already credited. */
const creditedPayments = async (admin: CitaSupabaseClient, paymentIds: string[]): Promise<Set<string>> => {
	const keys = await ledgerKeys(admin, paymentIds.map((id) => MP_PAYMENT_IDEMPOTENCY_PREFIX + id));
	return new Set([...keys].map((key) => key.slice(MP_PAYMENT_IDEMPOTENCY_PREFIX.length)));
};

export const reconcileMercadoPago = async (
	admin: CitaSupabaseClient,
	fetchFn: FetchLike,
	// `admits` lets a scheduled run start new work only while its worst case fits the budget.
	opts?: { limit?: number; budgetMs?: number; admits?: (calls: number) => boolean }
): Promise<MpReconcileSummary> => {
	const limit = opts?.limit ?? 20;
	const deadline = Date.now() + (opts?.budgetMs ?? RECONCILE_BUDGET_MS);
	const fits = (calls: number) => opts?.admits?.(calls) ?? true;
	const summary: MpReconcileSummary = {
		scanned: 0,
		credited: 0,
		attention: 0,
		errors: 0,
		details: []
	};

	// Las más viejas en sincronizarse primero: el cron rota toda la cartera
	// aunque cada corrida procese de a `limit`.
	const { data: rows, error } = await admin
		.from('mp_subscriptions')
		.select('business_id, preapproval_id, status, created_at')
		.in('status', ['pending', 'authorized', 'paused'])
		.order('last_synced_at', { ascending: true })
		.limit(limit)
		.retry(false);
	if (error) {
		throw new Error(`No se pudieron leer suscripciones para conciliar: ${error.message}`);
	}

	for (const row of rows ?? []) {
		if (Date.now() > deadline || !fits(RECONCILE_SUBSCRIPTION_CALLS)) {
			summary.details.push('Presupuesto agotado; continúa en la próxima corrida.');
			break;
		}
		summary.scanned += 1;
		try {
			const { ok, status: httpStatus, data: preapproval } = await getPreapproval(
				row.preapproval_id,
				fetchFn
			);
			if (!ok || !preapproval) {
				if (httpStatus === 404) {
					// Mercado Pago ya no la encuentra (otro entorno, de prueba o de producción, o borrada):
					// deja de revisarse cada 6 horas y avisa una sola vez (hallazgo M3).
					await admin
						.from('mp_subscriptions')
						.update({ status: 'not_found', last_synced_at: new Date().toISOString() })
						.eq('preapproval_id', row.preapproval_id);
					const alerted = await attentionOnce(admin, {
						topic: 'reconciliation',
						action: 'preapproval_not_found',
						resourceId: row.preapproval_id,
						businessId: row.business_id,
						detail: `Conciliación: Mercado Pago no encuentra la suscripción ${row.preapproval_id}, que figuraba ${row.status}. Puede ser de otro entorno (prueba o producción). Deja de revisarse; si era una suscripción real, revisarla en Mercado Pago.`
					});
					if (alerted) {
						summary.attention += 1;
						summary.details.push(`Suscripción ${row.preapproval_id}: Mercado Pago no la encuentra.`);
					}
					continue;
				}
				summary.errors += 1;
				summary.details.push(`Preapproval ${row.preapproval_id}: MP respondió HTTP ${httpStatus}.`);
				// La fila igual rota al fondo de la cola: una suscripción que
				// falla siempre (404 permanente) no debe monopolizar la ventana
				// de escaneo y dejar sin conciliar a las sanas.
				await admin
					.from('mp_subscriptions')
					.update({ last_synced_at: new Date().toISOString() })
					.eq('preapproval_id', row.preapproval_id);
				continue;
			}
			await upsertMpSubscription(admin, preapproval);

			const freshStatus = preapproval.status ?? 'pending';
			if (freshStatus !== row.status && ATTENTION_PREAPPROVAL_STATUSES.has(freshStatus)) {
				summary.attention += 1;
				summary.details.push(`Suscripción ${row.preapproval_id} pasó a ${freshStatus}.`);
				await logMpWebhookEvent(admin, {
					topic: 'reconciliation',
					action: 'subscription_status_changed',
					resource_id: row.preapproval_id,
					request_id: null,
					live_mode: null,
					signature_valid: true,
					processing_status: 'processed',
					processing_detail: `Conciliación: la suscripción pasó de ${row.status} a ${freshStatus}. El acceso vigente se agota solo; revisar si corresponde.`,
					business_id: row.business_id,
					requires_attention: true
				});
			}
			// Se buscan cobros salvo que nunca haya habido autorización (pending
			// no cobró jamás). Clave: una suscripción recién cancelada/pausada
			// sale del filtro en la próxima corrida, así que este es su último
			// barrido — si el webhook perdió su cobro final, se acredita acá.
			if (freshStatus === 'pending') {
				// Una solicitud que nadie completó en 7 días se cancela en Mercado Pago (hallazgo M10): deja de
				// revisarse y su enlace de pago ya no puede autorizar un débito.
				const createdAt = Date.parse(String(row.created_at ?? ''));
				if (Number.isFinite(createdAt) && Date.now() - createdAt > ABANDONED_PENDING_MS && fits(1)) {
					const cancelled = await cancelPreapproval(fetchFn, row.preapproval_id);
					if (cancelled.ok && cancelled.data) {
						await upsertMpSubscription(admin, {
							...preapproval,
							...cancelled.data,
							external_reference: cancelled.data.external_reference ?? preapproval.external_reference ?? row.business_id
						});
						summary.details.push(`Solicitud ${row.preapproval_id} sin completar desde hace más de 7 días: cancelada.`);
					} else {
						summary.errors += 1;
						summary.details.push(`Solicitud ${row.preapproval_id}: no se pudo cancelar (HTTP ${cancelled.status}).`);
					}
				}
				continue;
			}
			if (Date.now() > deadline) {
				summary.details.push('Presupuesto de tiempo agotado; continúa en la próxima corrida.');
				break;
			}

			// La primera página entra en el peor caso de la suscripción; cada página más se admite aparte.
			const {
				ok: searchOk,
				status: searchStatus,
				data: page
			} = await searchAuthorizedPayments(row.preapproval_id, fetchFn, {
				admitsPage: () => Date.now() <= deadline && fits(1)
			});
			if (!searchOk) {
				summary.errors += 1;
				summary.details.push(
					`Cobros de ${row.preapproval_id}: MP respondió HTTP ${searchStatus}.`
				);
				continue;
			}

			const charges = page?.results ?? [];
			// El último cobro (M6) y los rechazos recientes: una alerta por cuota mientras siga sin resolver.
			const latest = latestCharge(charges);
			if (latest) await recordLastCharge(admin, row.preapproval_id, latest);
			for (const charge of charges) {
				if (!isRejectedCharge(charge) || !isRecentCharge(charge) || !fits(2)) continue;
				const alerted = await attentionOnce(admin, {
					topic: 'subscription_charge',
					action: 'charge_rejected',
					resourceId: String(charge.id),
					businessId: row.business_id,
					detail: chargeRejectedDetail(charge, row.preapproval_id)
				});
				if (alerted) {
					summary.attention += 1;
					summary.details.push(`Cuota ${charge.id}: Mercado Pago no pudo cobrar.`);
				}
			}
			// Reembolsos y contracargos de los cobros (B4): el aviso los asienta; acá se curan los que se perdió.
			const reversed = charges.flatMap((charge) =>
				charge.payment?.id != null && CANCELLED_PAYMENT_STATUSES.has(charge.payment.status ?? '')
					? [{ paymentId: String(charge.payment.id), status: String(charge.payment.status), amount: charge.transaction_amount ?? null }]
					: []
			);
			const reversalKey = (paymentId: string) => `${MP_PAYMENT_IDEMPOTENCY_PREFIX}${paymentId}:cancelled`;
			const recordedReversals = await ledgerKeys(admin, reversed.map((charge) => reversalKey(charge.paymentId)));
			for (const charge of reversed) {
				if (recordedReversals.has(reversalKey(charge.paymentId)) || !fits(RECONCILE_CHARGE_CALLS)) continue;
				const outcome = await recordCancelledPayment(admin, {
					businessId: row.business_id,
					paymentId: charge.paymentId,
					amount: charge.amount,
					status: charge.status
				});
				if (outcome.kind !== 'credited') continue;
				summary.attention += 1;
				summary.details.push(`Pago ${charge.paymentId}: ${charge.status}.`);
				await logMpWebhookEvent(admin, {
					topic: 'reconciliation',
					action: 'payment_reversed',
					resource_id: charge.paymentId,
					request_id: null,
					live_mode: null,
					signature_valid: true,
					processing_status: 'processed',
					processing_detail: `Conciliación: el pago ${charge.paymentId} pasó a ${charge.status}; quedó asentado y el acceso no se modificó. Revisar.`,
					business_id: row.business_id,
					credited_grant_id: outcome.grantId,
					requires_attention: true
				});
			}

			const approved = charges.flatMap((charge) =>
				charge.payment?.id != null && charge.payment.status === 'approved'
					? [{ paymentId: String(charge.payment.id), amount: charge.transaction_amount ?? null }]
					: []
			);
			// Already credited is the normal case: it needs no further trip.
			const credited = await creditedPayments(admin, approved.map((charge) => charge.paymentId));
			for (const { paymentId, amount } of approved) {
				if (credited.has(paymentId)) continue;
				if (!fits(RECONCILE_CHARGE_CALLS)) {
					summary.details.push('Presupuesto agotado; continúa en la próxima corrida.');
					break;
				}
				const outcome = await creditApprovedPayment(admin, {
					businessId: row.business_id,
					paymentId,
					amount,
					origin: 'conciliación'
				});
				if (outcome.kind === 'credited') {
					summary.credited += 1;
					const blocked =
						outcome.statusAfter !== null && BLOCKED_STATUSES.has(outcome.statusAfter);
					if (blocked) summary.attention += 1;
					summary.details.push(`Pago ${paymentId} acreditado (+1 mes).`);
					await logMpWebhookEvent(admin, {
						topic: 'reconciliation',
						action: 'payment_credited',
						resource_id: paymentId,
						request_id: null,
						live_mode: null,
						signature_valid: true,
						processing_status: 'processed',
						processing_detail: blocked
							? `Conciliación: pago ${paymentId} acreditado pero el negocio queda "${outcome.statusAfter}" (override manual o alta sin configurar). Revisar.`
							: `Conciliación: pago ${paymentId} acreditado (+1 mes); webhook y retorno no lo habían registrado.`,
						business_id: row.business_id,
						credited_grant_id: outcome.grantId,
						requires_attention: blocked
					});
				} else if (outcome.kind === 'skipped') {
					// Condición persistente (negocio permanente / borrado con
					// preapproval vivo): el mismo pago se re-encuentra cada 6 h.
					// Se alerta UNA vez por pago para no sepultar el panel; el
					// contador de atención solo sube cuando realmente se alertó.
					const alerted = await logMpWebhookEventOnce(admin, {
						topic: 'reconciliation',
						action: 'payment_skipped',
						resource_id: paymentId,
						request_id: null,
						live_mode: null,
						signature_valid: true,
						processing_status: 'skipped',
						processing_detail:
							outcome.reason === 'unknown_business'
								? `Conciliación: pago ${paymentId} aprobado pero el negocio no existe en la base.`
								: `Conciliación: pago ${paymentId} aprobado sobre un negocio permanente; no se acredita duración. Si ya no querés cobrarle, cancelá el preapproval.`,
						business_id: row.business_id,
						requires_attention: true
					});
					if (alerted) {
						summary.attention += 1;
						summary.details.push(`Pago ${paymentId}: ${outcome.reason}.`);
					}
				}
				// 'duplicated' es el caso normal (ya acreditado): silencio.
			}
			// Lo leído ya se acreditó; lo que faltó se revisa en la próxima corrida, porque la fila
			// quedó sincronizada recién y rota al fondo de la cola.
			if (page && !page.complete) {
				summary.errors += 1;
				summary.details.push(`Cobros de ${row.preapproval_id}: revisión incompleta; sigue en la próxima corrida.`);
			}
		} catch (err) {
			summary.errors += 1;
			summary.details.push(
				err instanceof Error ? err.message : `Error desconocido conciliando ${row.preapproval_id}.`
			);
		}
	}

	// Resumen en la caja negra solo cuando la corrida hizo o encontró algo:
	// una corrida limpia cada 6 h no debe llenar la tabla.
	if (summary.credited > 0 || summary.attention > 0 || summary.errors > 0) {
		await logMpWebhookEvent(admin, {
			topic: 'reconciliation',
			action: 'run_summary',
			resource_id: null,
			request_id: null,
			live_mode: null,
			signature_valid: true,
			processing_status: summary.errors > 0 && summary.credited === 0 ? 'error' : 'processed',
			processing_detail: `Conciliación: ${summary.scanned} revisadas, ${summary.credited} acreditadas, ${summary.attention} para revisar, ${summary.errors} errores. ${summary.details.slice(0, 5).join(' | ')}`,
			business_id: null,
			requires_attention: summary.attention > 0
		});
	}

	return summary;
};


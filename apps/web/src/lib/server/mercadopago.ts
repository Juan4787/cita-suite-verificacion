import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hmacSha256HexMatches } from './hmac';

export const MP_API_BASE = 'https://api.mercadopago.com';

// Duración acreditada por cada cobro mensual aprobado. El preapproval se crea
// con frequency 1 month; se acreditan 30 días por cobro.
export const SUBSCRIPTION_DURATION_SECONDS = 30 * 24 * 60 * 60;

export const MP_PAYMENT_IDEMPOTENCY_PREFIX = 'mp:payment:';

// Ventana de frescura del ts de la firma: fuera de esto la notificación se
// rechaza aunque el HMAC sea correcto (anti-replay; MP reenvía con firma
// nueva, así que los reintentos legítimos no se ven afectados).
export const SIGNATURE_TS_TOLERANCE_SECONDS = 600;

type FetchLike = typeof fetch;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
	typeof value === 'string' && UUID_RE.test(value.trim());

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

export type MpApiResult<T> = { ok: boolean; status: number; data: T | null };

const mpGet = async <T>(path: string, fetchFn: FetchLike): Promise<MpApiResult<T>> => {
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
	let data: T | null = null;
	try {
		data = (await response.json()) as T;
	} catch {
		data = null;
	}
	return { ok: response.ok, status: response.status, data };
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
};

export type MpAuthorizedPayment = {
	id: number | string;
	preapproval_id?: string | null;
	status?: string;
	transaction_amount?: number | null;
	currency_id?: string | null;
	external_reference?: string | null;
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

export const getPayment = (id: string, fetchFn: FetchLike) =>
	mpGet<MpPayment>(`/v1/payments/${encodeURIComponent(id)}`, fetchFn);

export const getAuthorizedPayment = (id: string, fetchFn: FetchLike) =>
	mpGet<MpAuthorizedPayment>(`/authorized_payments/${encodeURIComponent(id)}`, fetchFn);

export const getPreapproval = (id: string, fetchFn: FetchLike) =>
	mpGet<MpPreapproval>(`/preapproval/${encodeURIComponent(id)}`, fetchFn);

export const searchAuthorizedPayments = (preapprovalId: string, fetchFn: FetchLike) =>
	// limit explícito: el default de MP es más chico y una suscripción de años
	// no debe dejar cobros viejos fuera de la página que revisa la conciliación.
	mpGet<{ results?: MpAuthorizedPayment[] }>(
		`/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}&limit=50`,
		fetchFn
	);

const mpSend = async <T>(
	method: 'POST' | 'PUT',
	path: string,
	body: Record<string, unknown>,
	fetchFn: FetchLike
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
	let data: T | null = null;
	try {
		data = (await response.json()) as T;
	} catch {
		data = null;
	}
	return { ok: response.ok, status: response.status, data };
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

// Precio global de la suscripción; configurable por env, con el valor acordado
// como respaldo para que un env faltante nunca genere un cobro en cero.
export const getSubscriptionAmountArs = (): number => {
	const parsed = Number(env.MP_SUBSCRIPTION_AMOUNT_ARS?.trim() ?? '');
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 50000;
};

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
		fetchFn
	);

export const cancelPreapproval = (fetchFn: FetchLike, preapprovalId: string) =>
	mpSend<MpPreapproval>(
		'PUT',
		`/preapproval/${encodeURIComponent(preapprovalId)}`,
		{ status: 'cancelled' },
		fetchFn
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

const businessExists = async (admin: SupabaseClient, businessId: string): Promise<boolean> => {
	const { data, error } = await admin
		.from('businesses')
		.select('id')
		.eq('id', businessId)
		.maybeSingle();
	if (error) {
		throw new Error(`No se pudo verificar el negocio ${businessId}: ${error.message}`);
	}
	return Boolean(data);
};

const businessIsPermanent = async (
	admin: SupabaseClient,
	businessId: string
): Promise<boolean> => {
	const { data, error } = await admin
		.from('business_subscriptions')
		.select('is_permanent')
		.eq('business_id', businessId)
		.maybeSingle();
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

const callGrantAccess = async (admin: SupabaseClient, opts: GrantCallOverrides) => {
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
		grantId: (row?.grant_id as string | undefined) ?? null,
		statusAfter: (row?.status_after as string | undefined) ?? null
	};
};

// Acredita 30 días por un pago aprobado. Idempotente: la clave
// `mp:payment:{id}` hace que webhook, retorno del checkout y conciliación
// puedan intentarlo sin duplicar. Pre-chequea existencia y permanencia del
// negocio para que un mapeo roto o un negocio permanente no terminen en un
// loop de reintentos de MP (la RPC sigue de guardia ante carreras).
export const creditApprovedPayment = async (
	admin: SupabaseClient,
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
		note: `Pago de Mercado Pago ${opts.paymentId} acreditado automáticamente (${opts.origin}).`,
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
	admin: SupabaseClient,
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
	admin: SupabaseClient,
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
			.limit(2);
		if (!dupError && (dupRows ?? []).length > 1) {
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
	admin: SupabaseClient,
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
	return (data?.business_id as string | undefined) ?? null;
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
	const base = outcome.kind === 'duplicated' ? `${what} ya estaba acreditado (idempotente).` : `${what} acreditado: +30 días.`;
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
	if (isUuid(external)) return external as string;
	const metaBusiness = payment.metadata?.business_id;
	if (isUuid(metaBusiness)) return metaBusiness as string;
	return null;
};

const processPaymentTopic = async (
	admin: SupabaseClient,
	fetchFn: FetchLike,
	resourceId: string,
	origin: string
): Promise<MpProcessResult> => {
	const { ok, status, data: payment } = await getPayment(resourceId, fetchFn);
	if (!ok || !payment) {
		return apiFailureResult(status, `el pago ${resourceId}`);
	}

	const businessId = resolvePaymentBusinessId(payment);
	const paymentStatus = payment.status ?? 'desconocido';

	if (paymentStatus === 'approved') {
		if (!businessId) {
			return {
				status: 'skipped',
				detail: `Pago ${resourceId} aprobado pero sin external_reference mapeable a un negocio.`,
				businessId: null,
				grantId: null,
				requiresAttention: true
			};
		}
		const outcome = await creditApprovedPayment(admin, {
			businessId,
			paymentId: String(payment.id),
			amount: payment.transaction_amount ?? null,
			origin
		});
		return creditOutcomeResult(outcome, businessId, `Pago ${resourceId}`);
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

const processAuthorizedPaymentTopic = async (
	admin: SupabaseClient,
	fetchFn: FetchLike,
	resourceId: string,
	origin: string
): Promise<MpProcessResult> => {
	const { ok, status, data: authorized } = await getAuthorizedPayment(resourceId, fetchFn);
	if (!ok || !authorized) {
		return apiFailureResult(status, `el cobro de suscripción ${resourceId}`);
	}

	const preapprovalId = authorized.preapproval_id?.trim() ?? '';
	let businessId = preapprovalId ? await findBusinessByPreapproval(admin, preapprovalId) : null;

	// Sin mapeo local: se reconstruye desde el preapproval (external_reference)
	// y se deja la fila creada para la próxima.
	if (!businessId && preapprovalId) {
		const { ok: preOk, data: preapproval } = await getPreapproval(preapprovalId, fetchFn);
		if (preOk && preapproval) {
			const upsert = await upsertMpSubscription(admin, preapproval);
			businessId = upsert.businessId;
		}
	}

	if (!businessId && isUuid(authorized.external_reference?.trim())) {
		businessId = authorized.external_reference!.trim();
	}

	const paymentId = authorized.payment?.id != null ? String(authorized.payment.id) : null;
	const paymentStatus = authorized.payment?.status ?? authorized.status ?? 'desconocido';

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
	admin: SupabaseClient,
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
	admin: SupabaseClient,
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
	admin: SupabaseClient,
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
		const preapprovalId = (row as { preapproval_id: string }).preapproval_id;
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

		const { ok: searchOk, data: page } = await searchAuthorizedPayments(preapprovalId, fetchFn);
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
export const settleApprovedChargesForPreapproval = async (
	admin: SupabaseClient,
	fetchFn: FetchLike,
	businessId: string,
	preapprovalId: string
): Promise<{ credited: number }> => {
	let credited = 0;
	const { ok, data: page } = await searchAuthorizedPayments(preapprovalId, fetchFn);
	if (!ok) return { credited };
	for (const charge of page?.results ?? []) {
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
	return { credited };
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
	admin: SupabaseClient,
	row: MpWebhookEventRow
): Promise<void> => {
	const { error } = await admin.from('mp_webhook_events').insert(row);
	if (error) {
		// El log nunca voltea el procesamiento: se deja rastro en la consola de
		// la función y se sigue.
		console.error('No se pudo registrar el evento de Mercado Pago', error, {
			topic: row.topic,
			resource_id: row.resource_id,
			processing_status: row.processing_status
		});
	}
};

// Variante idempotente para condiciones PERSISTENTES que se re-detectan en
// cada corrida (negocio permanente con preapproval vivo, mapeo roto, doble
// suscripción): alerta una sola vez por (action, resource_id) para que la
// conciliación de cada 6 h no sepulte las alertas reales bajo repeticiones.
export const logMpWebhookEventOnce = async (
	admin: SupabaseClient,
	row: MpWebhookEventRow & { action: string; resource_id: string }
): Promise<boolean> => {
	const { data: existing, error } = await admin
		.from('mp_webhook_events')
		.select('id')
		.eq('action', row.action)
		.eq('resource_id', row.resource_id)
		.limit(1)
		.maybeSingle();
	if (error) {
		console.error('No se pudo verificar eventos previos de Mercado Pago', error);
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

export const reconcileMercadoPago = async (
	admin: SupabaseClient,
	fetchFn: FetchLike,
	opts?: { limit?: number; budgetMs?: number }
): Promise<MpReconcileSummary> => {
	const limit = opts?.limit ?? 20;
	const deadline = Date.now() + (opts?.budgetMs ?? RECONCILE_BUDGET_MS);
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
		.select('business_id, preapproval_id, status')
		.in('status', ['pending', 'authorized', 'paused'])
		.order('last_synced_at', { ascending: true })
		.limit(limit);
	if (error) {
		throw new Error(`No se pudieron leer suscripciones para conciliar: ${error.message}`);
	}

	for (const row of (rows ?? []) as Array<{
		business_id: string;
		preapproval_id: string;
		status: string;
	}>) {
		if (Date.now() > deadline) {
			summary.details.push('Presupuesto de tiempo agotado; continúa en la próxima corrida.');
			break;
		}
		summary.scanned += 1;
		try {
			const { ok, status: httpStatus, data: preapproval } = await getPreapproval(
				row.preapproval_id,
				fetchFn
			);
			if (!ok || !preapproval) {
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
			if (freshStatus === 'pending') continue;
			if (Date.now() > deadline) {
				summary.details.push('Presupuesto de tiempo agotado; continúa en la próxima corrida.');
				break;
			}

			const {
				ok: searchOk,
				status: searchStatus,
				data: page
			} = await searchAuthorizedPayments(row.preapproval_id, fetchFn);
			if (!searchOk) {
				summary.errors += 1;
				summary.details.push(
					`Cobros de ${row.preapproval_id}: MP respondió HTTP ${searchStatus}.`
				);
				continue;
			}

			for (const charge of page?.results ?? []) {
				const paymentId = charge.payment?.id != null ? String(charge.payment.id) : null;
				if (!paymentId || charge.payment?.status !== 'approved') continue;
				const outcome = await creditApprovedPayment(admin, {
					businessId: row.business_id,
					paymentId,
					amount: charge.transaction_amount ?? null,
					origin: 'conciliación'
				});
				if (outcome.kind === 'credited') {
					summary.credited += 1;
					const blocked =
						outcome.statusAfter !== null && BLOCKED_STATUSES.has(outcome.statusAfter);
					if (blocked) summary.attention += 1;
					summary.details.push(`Pago ${paymentId} acreditado (+30 días).`);
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
							: `Conciliación: pago ${paymentId} acreditado (+30 días); webhook y retorno no lo habían registrado.`,
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

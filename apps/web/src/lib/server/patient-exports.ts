import { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	PATIENT_EXPORT_DATASETS,
	PATIENT_EXPORT_SCHEMA_VERSION,
	isPatientExportDataset,
	type PatientExportCounts,
	type PatientExportDataset,
	type PatientExportPage,
	type PatientExportRowsByDataset,
	type PatientExportScope,
	type PatientExportSession
} from '$lib/patient-export/contract';
import {
	enforceRateLimits,
	patientExportGlobalRateLimitRules,
	patientExportIndividualRateLimitRules,
	RateLimitExceededError,
	RateLimitUnavailableError
} from './rate-limits';
import { createSupabaseAdminClient, getUserIdFromAccessToken, type AuthTokens } from './supabase';

export const PATIENT_EXPORT_ERROR_CODES = [
	'EXPORT_INVALID_REQUEST',
	'EXPORT_NOT_AUTHENTICATED',
	'EXPORT_NOT_AUTHORIZED',
	'EXPORT_PATIENT_NOT_FOUND',
	'EXPORT_IN_PROGRESS',
	'EXPORT_RATE_LIMITED',
	'EXPORT_RATE_LIMIT_UNAVAILABLE',
	'EXPORT_SESSION_EXPIRED',
	'EXPORT_DATA_CHANGED',
	'EXPORT_COUNT_MISMATCH',
	'EXPORT_DEPENDENCY_UNAVAILABLE',
	'EXPORT_CANCELLED',
	'EXPORT_UNEXPECTED'
] as const;

export type PatientExportErrorCode = (typeof PATIENT_EXPORT_ERROR_CODES)[number];

type ErrorDefinition = {
	status: number;
	message: string;
	retryable: boolean;
};

const ERROR_DEFINITIONS: Record<PatientExportErrorCode, ErrorDefinition> = {
	EXPORT_INVALID_REQUEST: {
		status: 400,
		message: 'La solicitud de exportación no es válida. Volvé a intentarlo desde esta pantalla.',
		retryable: false
	},
	EXPORT_NOT_AUTHENTICATED: {
		status: 401,
		message: 'Tu sesión venció. Volvé a ingresar para exportar los datos.',
		retryable: false
	},
	EXPORT_NOT_AUTHORIZED: {
		status: 403,
		message: 'Ya no tenés permiso para exportar los datos de este consultorio.',
		retryable: false
	},
	EXPORT_PATIENT_NOT_FOUND: {
		status: 404,
		message: 'No encontramos al paciente que querías exportar.',
		retryable: false
	},
	EXPORT_IN_PROGRESS: {
		status: 409,
		message: 'Ya hay una exportación completa en preparación. Esperá a que termine o cancelala.',
		retryable: true
	},
	EXPORT_RATE_LIMITED: {
		status: 429,
		message: 'Preparaste varias exportaciones en poco tiempo. Esperá antes de volver a intentar.',
		retryable: true
	},
	EXPORT_RATE_LIMIT_UNAVAILABLE: {
		status: 503,
		message: 'No pudimos verificar el límite de uso. Intentá nuevamente en unos minutos.',
		retryable: true
	},
	EXPORT_SESSION_EXPIRED: {
		status: 410,
		message: 'La preparación tardó demasiado y venció. Iniciá una exportación nueva.',
		retryable: true
	},
	EXPORT_DATA_CHANGED: {
		status: 409,
		message: 'Los datos cambiaron mientras preparábamos el archivo. Intentá nuevamente.',
		retryable: true
	},
	EXPORT_COUNT_MISMATCH: {
		status: 409,
		message: 'No pudimos comprobar que el archivo estuviera completo. Volvé a prepararlo.',
		retryable: true
	},
	EXPORT_DEPENDENCY_UNAVAILABLE: {
		status: 503,
		message: 'No pudimos leer todos los datos en este momento. Intentá nuevamente en unos minutos.',
		retryable: true
	},
	EXPORT_CANCELLED: {
		status: 409,
		message: 'La exportación fue cancelada.',
		retryable: false
	},
	EXPORT_UNEXPECTED: {
		status: 500,
		message: 'No pudimos preparar el archivo. Intentá nuevamente.',
		retryable: true
	}
};

export class PatientExportError extends Error {
	code: PatientExportErrorCode;
	status: number;
	retryable: boolean;
	userMessage: string;
	retryAfterSeconds?: number;

	constructor(
		code: PatientExportErrorCode,
		options: { message?: string; cause?: unknown; retryAfterSeconds?: number } = {}
	) {
		const definition = ERROR_DEFINITIONS[code];
		super(options.message ?? definition.message, { cause: options.cause });
		this.name = 'PatientExportError';
		this.code = code;
		this.status = definition.status;
		this.retryable = definition.retryable;
		this.userMessage = options.message ?? definition.message;
		this.retryAfterSeconds = options.retryAfterSeconds;
	}
}

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
	typeof value === 'string' && UUID_PATTERN.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isPatientExportErrorCode = (value: unknown): value is PatientExportErrorCode =>
	typeof value === 'string' &&
	(PATIENT_EXPORT_ERROR_CODES as readonly string[]).includes(value);

const safeRpcErrorDetails = (error: unknown) => {
	if (!isRecord(error)) return { kind: typeof error };
	return {
		code: typeof error.code === 'string' ? error.code : undefined,
		name: typeof error.name === 'string' ? error.name : undefined
	};
};

const rpcEnvelope = async (
	supabase: SupabaseClient,
	operation: string,
	functionName: string,
	args: Record<string, unknown>
): Promise<Record<string, unknown>> => {
	const { data, error } = await supabase.rpc(functionName as never, args as never);
	if (error) {
		console.error('Fallo de dependencia en exportación de pacientes', {
			operation,
			...safeRpcErrorDetails(error)
		});
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE', { cause: error });
	}

	const value = Array.isArray(data) && data.length === 1 ? data[0] : data;
	if (!isRecord(value) || typeof value.ok !== 'boolean') {
		console.error('Respuesta inválida en exportación de pacientes', { operation });
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}
	if (value.ok !== true) {
		const code = isPatientExportErrorCode(value.error_code)
			? value.error_code
			: 'EXPORT_UNEXPECTED';
		throw new PatientExportError(code);
	}
	return value;
};

const parseCounts = (value: unknown): PatientExportCounts => {
	if (!isRecord(value)) throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	const counts = {} as PatientExportCounts;
	for (const dataset of PATIENT_EXPORT_DATASETS) {
		const count = value[dataset];
		if (!Number.isSafeInteger(count) || Number(count) < 0) {
			throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
		}
		counts[dataset] = Number(count);
	}
	return counts;
};

const parseIsoTimestamp = (value: unknown) => {
	if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}
	return value;
};

const invalidDependency = (): never => {
	throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
};

const requiredString = (row: Record<string, unknown>, key: string): string => {
	const value = row[key];
	return typeof value === 'string' ? value : invalidDependency();
};

const nullableString = (row: Record<string, unknown>, key: string): string | null => {
	const value = row[key];
	return value === null ? null : typeof value === 'string' ? value : invalidDependency();
};

const requiredUuid = (row: Record<string, unknown>, key: string): string => {
	const value = row[key];
	return isUuid(value) ? value : invalidDependency();
};

const nullableUuid = (row: Record<string, unknown>, key: string): string | null => {
	const value = row[key];
	return value === null ? null : isUuid(value) ? value : invalidDependency();
};

const requiredTimestamp = (row: Record<string, unknown>, key: string): string =>
	parseIsoTimestamp(row[key]);

const nullableTimestamp = (row: Record<string, unknown>, key: string): string | null => {
	const value = row[key];
	return value === null ? null : parseIsoTimestamp(value);
};

const nullableDate = (row: Record<string, unknown>, key: string): string | null => {
	const value = row[key];
	return value === null
		? null
		: typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
			? value
			: invalidDependency();
};

const enumString = <Value extends string>(
	row: Record<string, unknown>,
	key: string,
	allowed: readonly Value[]
): Value => {
	const value = row[key];
	return typeof value === 'string' && (allowed as readonly string[]).includes(value)
		? (value as Value)
		: invalidDependency();
};

const requiredBoolean = (row: Record<string, unknown>, key: string): boolean => {
	const value = row[key];
	return typeof value === 'boolean' ? value : invalidDependency();
};

const nonNegativeInteger = (row: Record<string, unknown>, key: string): number => {
	const value = row[key];
	return Number.isSafeInteger(value) && Number(value) >= 0
		? Number(value)
		: invalidDependency();
};

const nullableExactAmount = (
	row: Record<string, unknown>,
	key: string
): number | string | null => {
	const value = row[key];
	if (value === null) return null;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.length <= 1_000 && /^-?\d+(?:\.\d+)?$/.test(value)) {
		return value;
	}
	return invalidDependency();
};

const parsePatientExportRow = (
	dataset: PatientExportDataset,
	row: Record<string, unknown>
): PatientExportRowsByDataset[PatientExportDataset] => {
	switch (dataset) {
		case 'patients':
			return {
				patient_id: requiredUuid(row, 'patient_id'),
				full_name: requiredString(row, 'full_name'),
				dni: nullableString(row, 'dni'),
				phone: nullableString(row, 'phone'),
				email: nullableString(row, 'email'),
				birth_date: nullableDate(row, 'birth_date'),
				address: nullableString(row, 'address'),
				insurance: nullableString(row, 'insurance'),
				insurance_plan: nullableString(row, 'insurance_plan'),
				allergies: nullableString(row, 'allergies'),
				medication: nullableString(row, 'medication'),
				background: nullableString(row, 'background'),
				clinical_alert_note: nullableString(row, 'clinical_alert_note'),
				clinical_notes: nullableString(row, 'clinical_notes'),
				status: enumString(row, 'status', ['active', 'archived'] as const),
				archived_at: nullableTimestamp(row, 'archived_at'),
				created_at: requiredTimestamp(row, 'created_at'),
				updated_at: requiredTimestamp(row, 'updated_at')
			};
		case 'custom_fields':
			return {
				patient_id: requiredUuid(row, 'patient_id'),
				field_key: requiredString(row, 'field_key'),
				field_label: requiredString(row, 'field_label'),
				value_type: enumString(row, 'value_type', [
					'string',
					'number',
					'boolean',
					'null',
					'object',
					'array'
				] as const),
				value_text: nullableString(row, 'value_text'),
				value_json: nullableString(row, 'value_json')
			};
		case 'clinical_entries':
			return {
				clinical_entry_id: requiredUuid(row, 'clinical_entry_id'),
				patient_id: requiredUuid(row, 'patient_id'),
				occurred_at: requiredTimestamp(row, 'occurred_at'),
				entry_type: requiredString(row, 'entry_type'),
				description: requiredString(row, 'description'),
				teeth: nullableString(row, 'teeth'),
				internal_note: nullableString(row, 'internal_note'),
				amount: nullableExactAmount(row, 'amount'),
				professional_id: nullableUuid(row, 'professional_id'),
				professional_name: nullableString(row, 'professional_name'),
				status: enumString(row, 'status', ['active', 'archived'] as const),
				archived_at: nullableTimestamp(row, 'archived_at'),
				created_at: requiredTimestamp(row, 'created_at'),
				updated_at: requiredTimestamp(row, 'updated_at')
			};
		case 'appointments':
			return {
				appointment_id: requiredUuid(row, 'appointment_id'),
				patient_id: requiredUuid(row, 'patient_id'),
				starts_at: requiredTimestamp(row, 'starts_at'),
				ends_at: requiredTimestamp(row, 'ends_at'),
				status: enumString(row, 'status', [
					'reserved',
					'confirmed',
					'cancelled',
					'reschedule_requested'
				] as const),
				source: enumString(row, 'source', [
					'manual',
					'public_booking',
					'whatsapp_bot',
					'admin'
				] as const),
				service_name_snapshot: requiredString(row, 'service_name_snapshot'),
				internal_note: nullableString(row, 'internal_note'),
				professional_name_snapshot: requiredString(row, 'professional_name_snapshot'),
				confirmed_at: nullableTimestamp(row, 'confirmed_at'),
				cancelled_at: nullableTimestamp(row, 'cancelled_at'),
				reschedule_requested_at: nullableTimestamp(row, 'reschedule_requested_at'),
				cancelled_reason: nullableString(row, 'cancelled_reason'),
				created_at: requiredTimestamp(row, 'created_at'),
				updated_at: requiredTimestamp(row, 'updated_at')
			};
		case 'appointment_professionals':
			return {
				allocation_id: requiredUuid(row, 'allocation_id'),
				appointment_id: requiredUuid(row, 'appointment_id'),
				patient_id: requiredUuid(row, 'patient_id'),
				professional_id: requiredUuid(row, 'professional_id'),
				professional_name: requiredString(row, 'professional_name'),
				is_primary: requiredBoolean(row, 'is_primary'),
				position: nonNegativeInteger(row, 'position')
			};
		case 'follow_ups':
			return {
				follow_up_id: requiredUuid(row, 'follow_up_id'),
				patient_id: requiredUuid(row, 'patient_id'),
				remind_on:
					nullableDate(row, 'remind_on') ?? invalidDependency(),
				message: nullableString(row, 'message'),
				status: enumString(row, 'status', ['pending', 'done'] as const),
				assigned_professional_id: nullableUuid(row, 'assigned_professional_id'),
				assigned_professional_name: nullableString(row, 'assigned_professional_name'),
				done_at: nullableTimestamp(row, 'done_at'),
				created_at: requiredTimestamp(row, 'created_at'),
				updated_at: requiredTimestamp(row, 'updated_at')
			};
	}
};

const parseSession = (value: Record<string, unknown>): PatientExportSession => {
	if (
		typeof value.reused !== 'boolean' ||
		!isUuid(value.export_id) ||
		(value.scope !== 'patient' && value.scope !== 'all_patients') ||
		(value.patient_id !== null && !isUuid(value.patient_id)) ||
		value.schema_version !== PATIENT_EXPORT_SCHEMA_VERSION ||
		!Array.isArray(value.datasets) ||
		value.datasets.length !== PATIENT_EXPORT_DATASETS.length ||
		!value.datasets.every((dataset, index) => dataset === PATIENT_EXPORT_DATASETS[index]) ||
		!isRecord(value.business) ||
		typeof value.business.name !== 'string' ||
		typeof value.business.timezone !== 'string'
	) {
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}
	if (value.scope === 'patient' && !isUuid(value.patient_id)) {
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}
	if (value.scope === 'all_patients' && value.patient_id !== null) {
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}

	return {
		reused: value.reused,
		export_id: value.export_id,
		scope: value.scope,
		patient_id: value.patient_id,
		schema_version: value.schema_version,
		expected_counts: parseCounts(value.expected_counts),
		datasets: [...PATIENT_EXPORT_DATASETS],
		business: {
			name: value.business.name,
			timezone: value.business.timezone
		},
		expires_at: parseIsoTimestamp(value.expires_at)
	};
};

const encodeCursor = (cursor: unknown): string | null => {
	if (cursor === null || cursor === undefined) return null;
	if (!isRecord(cursor)) throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
};

export const decodePatientExportCursor = (cursor: string | null): Record<string, unknown> | null => {
	if (!cursor) return null;
	if (cursor.length > 32_768 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
		throw new PatientExportError('EXPORT_INVALID_REQUEST');
	}
	try {
		const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
		const value = JSON.parse(decoded) as unknown;
		if (!isRecord(value)) throw new Error('CURSOR_NOT_OBJECT');
		return value;
	} catch (error) {
		throw new PatientExportError('EXPORT_INVALID_REQUEST', { cause: error });
	}
};

export const readPatientExportJson = async (
	request: Request,
	maxBytes = 8_192
): Promise<Record<string, unknown>> => {
	const declaredLength = Number(request.headers.get('content-length') ?? 0);
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new PatientExportError('EXPORT_INVALID_REQUEST');
	}

	let text: string;
	try {
		text = await request.text();
	} catch (error) {
		throw new PatientExportError('EXPORT_INVALID_REQUEST', { cause: error });
	}
	if (new TextEncoder().encode(text).byteLength > maxBytes) {
		throw new PatientExportError('EXPORT_INVALID_REQUEST');
	}
	try {
		const value = JSON.parse(text) as unknown;
		if (!isRecord(value)) throw new Error('BODY_NOT_OBJECT');
		return value;
	} catch (error) {
		throw new PatientExportError('EXPORT_INVALID_REQUEST', { cause: error });
	}
};

export const getPatientExportActorId = (auth: AuthTokens | null): string => {
	const userId = getUserIdFromAccessToken(auth?.access_token);
	if (!isUuid(userId)) throw new PatientExportError('EXPORT_NOT_AUTHENTICATED');
	return userId;
};

export const createPatientExportAdminClient = async (fetchImpl?: typeof fetch) => {
	try {
		return await createSupabaseAdminClient('odonto', fetchImpl);
	} catch (error) {
		console.error('Control plane no disponible para exportación de pacientes', {
			name: error instanceof Error ? error.name : typeof error
		});
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE', { cause: error });
	}
};

export const startPatientExport = async ({
	supabase,
	businessId,
	actorUserId,
	scope,
	patientId,
	requestKey,
	fetchImpl
}: {
	supabase: SupabaseClient;
	businessId: string;
	actorUserId: string;
	scope: PatientExportScope;
	patientId: string | null;
	requestKey: string;
	fetchImpl?: typeof fetch;
}): Promise<PatientExportSession> => {
	try {
		await enforceRateLimits(
			scope === 'patient'
				? patientExportIndividualRateLimitRules(actorUserId)
				: patientExportGlobalRateLimitRules(businessId),
			fetchImpl
		);
	} catch (error) {
		if (error instanceof RateLimitExceededError) {
			throw new PatientExportError('EXPORT_RATE_LIMITED', {
				message: error.userMessage,
				cause: error,
				retryAfterSeconds: error.retryAfterSeconds
			});
		}
		if (error instanceof RateLimitUnavailableError) {
			throw new PatientExportError('EXPORT_RATE_LIMIT_UNAVAILABLE', { cause: error });
		}
		throw error;
	}

	const result = await rpcEnvelope(supabase, 'begin', 'begin_patient_export', {
		p_actor_user_id: actorUserId,
		p_business_id: businessId,
		p_scope: scope,
		p_patient_id: patientId,
		p_request_key: requestKey
	});
	return parseSession(result);
};

const PAGE_SIZE_BY_DATASET: Record<PatientExportDataset, number> = {
	patients: 100,
	custom_fields: 200,
	clinical_entries: 100,
	appointments: 200,
	appointment_professionals: 200,
	follow_ups: 100
};

export const readPatientExportPage = async <Dataset extends PatientExportDataset>({
	supabase,
	actorUserId,
	exportId,
	dataset,
	cursor
}: {
	supabase: SupabaseClient;
	actorUserId: string;
	exportId: string;
	dataset: Dataset;
	cursor: string | null;
}): Promise<PatientExportPage<Dataset>> => {
	const result = await rpcEnvelope(supabase, 'read_page', 'read_patient_export_page', {
		p_actor_user_id: actorUserId,
		p_export_id: exportId,
		p_dataset: dataset,
		p_cursor: decodePatientExportCursor(cursor),
		p_limit: PAGE_SIZE_BY_DATASET[dataset]
	});

	if (
		result.export_id !== exportId ||
		result.dataset !== dataset ||
		!Array.isArray(result.rows) ||
		!result.rows.every(isRecord) ||
		!Number.isSafeInteger(result.row_count) ||
		result.row_count !== result.rows.length ||
		typeof result.done !== 'boolean'
	) {
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}
	const nextCursor = encodeCursor(result.next_cursor);
	if ((result.done && nextCursor !== null) || (!result.done && nextCursor === null)) {
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}

	let rows: PatientExportPage<Dataset>['rows'];
	try {
		rows = result.rows.map((row) => parsePatientExportRow(dataset, row)) as PatientExportPage<Dataset>['rows'];
	} catch (error) {
		console.error('Fila inválida en exportación de pacientes', { dataset });
		throw error;
	}

	return {
		export_id: exportId,
		dataset,
		rows,
		row_count: result.row_count,
		next_cursor: nextCursor,
		done: result.done,
		expires_at: parseIsoTimestamp(result.expires_at)
	};
};

export const validatePatientExport = async ({
	supabase,
	actorUserId,
	exportId,
	receivedCounts
}: {
	supabase: SupabaseClient;
	actorUserId: string;
	exportId: string;
	receivedCounts: PatientExportCounts;
}) => {
	const result = await rpcEnvelope(supabase, 'validate', 'validate_patient_export', {
		p_actor_user_id: actorUserId,
		p_export_id: exportId,
		p_received_counts: receivedCounts
	});
	if (result.validated !== true) {
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}
	return { validated: true as const, validated_at: parseIsoTimestamp(result.validated_at) };
};

export const cancelPatientExport = async ({
	supabase,
	actorUserId,
	exportId
}: {
	supabase: SupabaseClient;
	actorUserId: string;
	exportId: string;
}) => {
	const result = await rpcEnvelope(supabase, 'cancel', 'cancel_patient_export', {
		p_actor_user_id: actorUserId,
		p_export_id: exportId
	});
	if (typeof result.status !== 'string') {
		throw new PatientExportError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}
	return { status: result.status };
};

export const normalizePatientExportError = (error: unknown): PatientExportError =>
	error instanceof PatientExportError
		? error
		: new PatientExportError('EXPORT_UNEXPECTED', { cause: error });

export const patientExportErrorBody = (error: PatientExportError) => ({
	error: {
		code: error.code,
		message: error.userMessage,
		retryable: error.retryable
	}
});

export const isValidPatientExportCounts = (value: unknown): value is PatientExportCounts => {
	if (!isRecord(value) || Object.keys(value).length !== PATIENT_EXPORT_DATASETS.length) return false;
	return PATIENT_EXPORT_DATASETS.every(
		(dataset) => Number.isSafeInteger(value[dataset]) && Number(value[dataset]) >= 0
	);
};

export const assertPatientExportDataset = (value: string): PatientExportDataset => {
	if (!isPatientExportDataset(value)) throw new PatientExportError('EXPORT_INVALID_REQUEST');
	return value;
};

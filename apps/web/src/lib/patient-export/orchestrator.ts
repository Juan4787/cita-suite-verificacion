import {
	PATIENT_EXPORT_DATASETS,
	PATIENT_EXPORT_SCHEMA_VERSION,
	emptyPatientExportCounts,
	type PatientExportCounts,
	type PatientExportDataset,
	type PatientExportDatasetRows,
	type PatientExportRowsByDataset,
	type PatientExportScope,
	type PatientExportSession
} from './contract';

const MAX_CONTROL_RESPONSE_BYTES = 256 * 1024;
const MAX_PAGE_RESPONSE_BYTES = 32 * 1024 * 1024;

export const PATIENT_EXPORT_DATASET_LABELS: Record<PatientExportDataset, string> = {
	patients: 'Pacientes',
	custom_fields: 'Datos adicionales',
	clinical_entries: 'Historia clínica',
	appointments: 'Turnos',
	appointment_professionals: 'Profesionales de turnos',
	follow_ups: 'Seguimientos'
};

const SERVER_ERROR_CODES = [
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

type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];
export type PatientExportClientErrorCode =
	| ServerErrorCode
	| 'EXPORT_NETWORK_UNAVAILABLE'
	| 'EXPORT_RESPONSE_TOO_LARGE'
	| 'EXPORT_WORKBOOK_FAILED';

const ERROR_DEFINITIONS: Record<
	PatientExportClientErrorCode,
	{ message: string; retryable: boolean }
> = {
	EXPORT_INVALID_REQUEST: {
		message: 'No pudimos iniciar la exportación desde esta pantalla. Recargá la página e intentá nuevamente.',
		retryable: true
	},
	EXPORT_NOT_AUTHENTICATED: {
		message: 'Tu sesión venció. Volvé a ingresar para exportar los datos.',
		retryable: false
	},
	EXPORT_NOT_AUTHORIZED: {
		message: 'Ya no tenés permiso para exportar los datos de este consultorio.',
		retryable: false
	},
	EXPORT_PATIENT_NOT_FOUND: {
		message: 'No encontramos al paciente que querías exportar.',
		retryable: false
	},
	EXPORT_IN_PROGRESS: {
		message: 'Ya hay una exportación completa en preparación. Esperá a que termine o cancelala.',
		retryable: true
	},
	EXPORT_RATE_LIMITED: {
		message: 'Preparaste varias exportaciones en poco tiempo. Esperá antes de volver a intentar.',
		retryable: true
	},
	EXPORT_RATE_LIMIT_UNAVAILABLE: {
		message: 'No pudimos verificar el límite de uso. Intentá nuevamente en unos minutos.',
		retryable: true
	},
	EXPORT_SESSION_EXPIRED: {
		message: 'La preparación tardó demasiado y venció. Iniciá una exportación nueva.',
		retryable: true
	},
	EXPORT_DATA_CHANGED: {
		message: 'Los datos cambiaron mientras preparábamos el archivo. Intentá nuevamente.',
		retryable: true
	},
	EXPORT_COUNT_MISMATCH: {
		message: 'No pudimos comprobar que el archivo estuviera completo. Volvé a prepararlo.',
		retryable: true
	},
	EXPORT_DEPENDENCY_UNAVAILABLE: {
		message: 'No pudimos leer todos los datos en este momento. Intentá nuevamente en unos minutos.',
		retryable: true
	},
	EXPORT_CANCELLED: {
		message: 'La exportación fue cancelada.',
		retryable: false
	},
	EXPORT_UNEXPECTED: {
		message: 'No pudimos preparar el archivo. Intentá nuevamente.',
		retryable: true
	},
	EXPORT_NETWORK_UNAVAILABLE: {
		message: 'Se interrumpió la conexión mientras preparábamos el archivo. Revisá internet e intentá nuevamente.',
		retryable: true
	},
	EXPORT_RESPONSE_TOO_LARGE: {
		message: 'Uno de los registros es demasiado grande para prepararlo en el navegador. Contactá a soporte para exportarlo sin perder contenido.',
		retryable: false
	},
	EXPORT_WORKBOOK_FAILED: {
		message: 'No pudimos crear el archivo Excel. Volvé a intentarlo.',
		retryable: true
	}
};

export class PatientExportOrchestrationError extends Error {
	code: PatientExportClientErrorCode;
	retryable: boolean;
	retryAfterSeconds?: number;

	constructor(
		code: PatientExportClientErrorCode,
		options: { message?: string; cause?: unknown; retryAfterSeconds?: number } = {}
	) {
		const definition = ERROR_DEFINITIONS[code];
		super(options.message ?? definition.message, { cause: options.cause });
		this.name = 'PatientExportOrchestrationError';
		this.code = code;
		this.retryable = definition.retryable;
		this.retryAfterSeconds = options.retryAfterSeconds;
	}
}

export type PatientExportProgress =
	| { stage: 'starting'; attempt: number }
	| {
			stage: 'fetching';
			attempt: number;
			dataset: PatientExportDataset;
			received: number;
			expected: number;
	  }
	| { stage: 'validating'; attempt: number }
	| { stage: 'retrying'; attempt: 2 }
	| { stage: 'transforming'; attempt: number }
	| { stage: 'writing'; attempt: number };

export type PreparePatientExportOptions = {
	scope: PatientExportScope;
	patientId?: string | null;
	signal?: AbortSignal;
	onProgress?: (progress: PatientExportProgress) => void;
	onSessionCancelChange?: (cancel: (() => void) | null) => void;
	fetchImpl?: typeof fetch;
};

export type PreparedPatientExport = {
	blob: Blob;
	filename: string;
	byteLength: number;
	counts: PatientExportCounts;
	scope: PatientExportScope;
};

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isServerErrorCode = (value: unknown): value is ServerErrorCode =>
	typeof value === 'string' && (SERVER_ERROR_CODES as readonly string[]).includes(value);

const assertNotCancelled = (signal?: AbortSignal) => {
	if (signal?.aborted) throw new PatientExportOrchestrationError('EXPORT_CANCELLED');
};

const responseRetryAfter = (response: Response): number | undefined => {
	const value = Number(response.headers.get('retry-after'));
	return Number.isSafeInteger(value) && value > 0 && value <= 86_400 ? value : undefined;
};

const readJsonWithLimit = async (response: Response, maxBytes: number): Promise<unknown> => {
	const declaredBytes = Number(response.headers.get('content-length'));
	if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
		throw new PatientExportOrchestrationError('EXPORT_RESPONSE_TOO_LARGE');
	}

	if (!response.body) {
		const text = await response.text();
		if (new TextEncoder().encode(text).byteLength > maxBytes) {
			throw new PatientExportOrchestrationError('EXPORT_RESPONSE_TOO_LARGE');
		}
		try {
			return JSON.parse(text) as unknown;
		} catch (error) {
			throw new PatientExportOrchestrationError('EXPORT_DEPENDENCY_UNAVAILABLE', { cause: error });
		}
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			bytes += result.value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				throw new PatientExportOrchestrationError('EXPORT_RESPONSE_TOO_LARGE');
			}
			chunks.push(result.value);
		}
	} finally {
		reader.releaseLock();
	}

	const merged = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(merged)) as unknown;
	} catch (error) {
		throw new PatientExportOrchestrationError('EXPORT_DEPENDENCY_UNAVAILABLE', { cause: error });
	}
};

const requestJson = async (
	fetchImpl: typeof fetch,
	input: RequestInfo | URL,
	init: RequestInit,
	maxBytes: number,
	retryTransportOnce = false
): Promise<unknown> => {
	let response: Response | null = null;
	for (let attempt = 0; attempt <= (retryTransportOnce ? 1 : 0); attempt += 1) {
		try {
			response = await fetchImpl(input, init);
			break;
		} catch (error) {
			if (init.signal?.aborted) {
				throw new PatientExportOrchestrationError('EXPORT_CANCELLED', { cause: error });
			}
			if (!(error instanceof TypeError) || attempt === 1 || !retryTransportOnce) {
				throw new PatientExportOrchestrationError('EXPORT_NETWORK_UNAVAILABLE', { cause: error });
			}
		}
	}
	if (!response) throw new PatientExportOrchestrationError('EXPORT_NETWORK_UNAVAILABLE');

	if (!response.ok) {
		let body: unknown = null;
		try {
			body = await readJsonWithLimit(response, MAX_CONTROL_RESPONSE_BYTES);
		} catch (error) {
			if (error instanceof PatientExportOrchestrationError && error.code === 'EXPORT_RESPONSE_TOO_LARGE') {
				throw error;
			}
		}
		const code =
			isRecord(body) && isRecord(body.error) && isServerErrorCode(body.error.code)
				? body.error.code
				: 'EXPORT_UNEXPECTED';
		throw new PatientExportOrchestrationError(code, {
			retryAfterSeconds: responseRetryAfter(response)
		});
	}

	return readJsonWithLimit(response, maxBytes);
};

const parseCounts = (value: unknown): PatientExportCounts => {
	if (!isRecord(value)) throw new PatientExportOrchestrationError('EXPORT_DEPENDENCY_UNAVAILABLE');
	const counts = emptyPatientExportCounts();
	for (const dataset of PATIENT_EXPORT_DATASETS) {
		const count = value[dataset];
		if (!Number.isSafeInteger(count) || Number(count) < 0) {
			throw new PatientExportOrchestrationError('EXPORT_DEPENDENCY_UNAVAILABLE');
		}
		counts[dataset] = Number(count);
	}
	return counts;
};

const parseSession = (
	value: unknown,
	scope: PatientExportScope,
	patientId: string | null
): PatientExportSession => {
	if (
		!isRecord(value) ||
		typeof value.reused !== 'boolean' ||
		typeof value.export_id !== 'string' ||
		!UUID_PATTERN.test(value.export_id) ||
		value.scope !== scope ||
		value.patient_id !== patientId ||
		value.schema_version !== PATIENT_EXPORT_SCHEMA_VERSION ||
		!Array.isArray(value.datasets) ||
		value.datasets.length !== PATIENT_EXPORT_DATASETS.length ||
		!value.datasets.every((dataset, index) => dataset === PATIENT_EXPORT_DATASETS[index]) ||
		!isRecord(value.business) ||
		typeof value.business.name !== 'string' ||
		typeof value.business.timezone !== 'string' ||
		typeof value.expires_at !== 'string' ||
		!Number.isFinite(Date.parse(value.expires_at))
	) {
		throw new PatientExportOrchestrationError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}

	return {
		reused: value.reused,
		export_id: value.export_id,
		scope,
		patient_id: patientId,
		schema_version: PATIENT_EXPORT_SCHEMA_VERSION,
		expected_counts: parseCounts(value.expected_counts),
		datasets: [...PATIENT_EXPORT_DATASETS],
		business: { name: value.business.name, timezone: value.business.timezone },
		expires_at: value.expires_at
	};
};

type ParsedPage = {
	rows: Record<string, unknown>[];
	nextCursor: string | null;
	done: boolean;
};

const parsePage = (
	value: unknown,
	exportId: string,
	dataset: PatientExportDataset
): ParsedPage => {
	if (
		!isRecord(value) ||
		value.export_id !== exportId ||
		value.dataset !== dataset ||
		!Array.isArray(value.rows) ||
		!value.rows.every(isRecord) ||
		!Number.isSafeInteger(value.row_count) ||
		value.row_count !== value.rows.length ||
		typeof value.done !== 'boolean' ||
		typeof value.expires_at !== 'string' ||
		!Number.isFinite(Date.parse(value.expires_at))
	) {
		throw new PatientExportOrchestrationError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}
	const nextCursor = value.next_cursor;
	if (
		(nextCursor !== null &&
			(typeof nextCursor !== 'string' ||
				nextCursor.length === 0 ||
				nextCursor.length > 32_768 ||
				!CURSOR_PATTERN.test(nextCursor))) ||
		(value.done && nextCursor !== null) ||
		(!value.done && nextCursor === null)
	) {
		throw new PatientExportOrchestrationError('EXPORT_DEPENDENCY_UNAVAILABLE');
	}
	return { rows: value.rows, nextCursor, done: value.done };
};

const emptyDatasetRows = (): PatientExportDatasetRows => ({
	patients: [],
	custom_fields: [],
	clinical_entries: [],
	appointments: [],
	appointment_professionals: [],
	follow_ups: []
});

const appendRows = <Dataset extends PatientExportDataset>(
	datasets: PatientExportDatasetRows,
	dataset: Dataset,
	rows: Record<string, unknown>[]
) => {
	(datasets[dataset] as PatientExportRowsByDataset[Dataset][]).push(
		...(rows as PatientExportRowsByDataset[Dataset][])
	);
};

const cancelSession = async (fetchImpl: typeof fetch, exportId: string): Promise<void> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5_000);
	try {
		await fetchImpl(`/api/odonto/exportaciones/${encodeURIComponent(exportId)}`, {
			method: 'DELETE',
			headers: { accept: 'application/json' },
			credentials: 'same-origin',
			cache: 'no-store',
			keepalive: true,
			signal: controller.signal
		});
	} catch {
		// La expiracion servidor sigue siendo la red de seguridad si el navegador
		// se cierra o pierde conectividad durante este intento de cancelacion.
	} finally {
		clearTimeout(timeout);
	}
};

const normalizeUnexpectedError = (error: unknown, signal?: AbortSignal) => {
	if (error instanceof PatientExportOrchestrationError) return error;
	if (signal?.aborted || (error instanceof Error && error.name === 'PatientExportBuildCancelledError')) {
		return new PatientExportOrchestrationError('EXPORT_CANCELLED', { cause: error });
	}
	return new PatientExportOrchestrationError('EXPORT_WORKBOOK_FAILED', { cause: error });
};

const runAttempt = async (
	options: PreparePatientExportOptions,
	attempt: number
): Promise<PreparedPatientExport> => {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
	const patientId = options.scope === 'patient' ? (options.patientId ?? null) : null;
	if (
		(options.scope === 'patient' && (typeof patientId !== 'string' || !UUID_PATTERN.test(patientId))) ||
		(options.scope === 'all_patients' && options.patientId != null)
	) {
		throw new PatientExportOrchestrationError('EXPORT_INVALID_REQUEST');
	}

	let exportId: string | null = null;
	let datasetValidated = false;
	let cancellationPromise: Promise<void> | null = null;
	let requestSessionCancellation: (() => Promise<void>) | null = null;
	try {
		assertNotCancelled(options.signal);
		options.onProgress?.({ stage: 'starting', attempt });
		const requestKey = crypto.randomUUID();
		const session = parseSession(
			await requestJson(
				fetchImpl,
				'/api/odonto/exportaciones',
				{
					method: 'POST',
					headers: { accept: 'application/json', 'content-type': 'application/json' },
					credentials: 'same-origin',
					cache: 'no-store',
					signal: options.signal,
					body: JSON.stringify({
						scope: options.scope,
						patient_id: patientId,
						request_key: requestKey
					})
				},
				MAX_CONTROL_RESPONSE_BYTES,
				true
			),
			options.scope,
			patientId
		);
		exportId = session.export_id;
		requestSessionCancellation = () =>
			(cancellationPromise ??= cancelSession(fetchImpl, session.export_id));
		options.onSessionCancelChange?.(() => {
			void requestSessionCancellation?.();
		});

		let datasets = emptyDatasetRows();
		for (const dataset of PATIENT_EXPORT_DATASETS) {
			let cursor: string | null = null;
			const seenCursors = new Set<string>();
			let received = 0;
			options.onProgress?.({
				stage: 'fetching',
				attempt,
				dataset,
				received,
				expected: session.expected_counts[dataset]
			});

			while (true) {
				assertNotCancelled(options.signal);
				const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
				const page = parsePage(
					await requestJson(
						fetchImpl,
						`/api/odonto/exportaciones/${encodeURIComponent(exportId)}/hojas/${dataset}${query}`,
						{
							method: 'GET',
							headers: { accept: 'application/json' },
							credentials: 'same-origin',
							cache: 'no-store',
							signal: options.signal
						},
						MAX_PAGE_RESPONSE_BYTES,
						true
					),
					exportId,
					dataset
				);
				appendRows(datasets, dataset, page.rows);
				received += page.rows.length;
				if (received > session.expected_counts[dataset]) {
					throw new PatientExportOrchestrationError('EXPORT_COUNT_MISMATCH');
				}
				options.onProgress?.({
					stage: 'fetching',
					attempt,
					dataset,
					received,
					expected: session.expected_counts[dataset]
				});
				if (page.done) break;
				if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
					throw new PatientExportOrchestrationError('EXPORT_COUNT_MISMATCH');
				}
				seenCursors.add(page.nextCursor);
				cursor = page.nextCursor;
			}

			if (received !== session.expected_counts[dataset]) {
				throw new PatientExportOrchestrationError('EXPORT_COUNT_MISMATCH');
			}
		}

		const receivedCounts: PatientExportCounts = {
			patients: datasets.patients.length,
			custom_fields: datasets.custom_fields.length,
			clinical_entries: datasets.clinical_entries.length,
			appointments: datasets.appointments.length,
			appointment_professionals: datasets.appointment_professionals.length,
			follow_ups: datasets.follow_ups.length
		};
		options.onProgress?.({ stage: 'validating', attempt });
		const validation = await requestJson(
			fetchImpl,
			`/api/odonto/exportaciones/${encodeURIComponent(exportId)}/validaciones`,
			{
				method: 'POST',
				headers: { accept: 'application/json', 'content-type': 'application/json' },
				credentials: 'same-origin',
				cache: 'no-store',
				signal: options.signal,
				body: JSON.stringify({ received_counts: receivedCounts })
			},
			MAX_CONTROL_RESPONSE_BYTES
		);
		if (
			!isRecord(validation) ||
			validation.validated !== true ||
			typeof validation.validated_at !== 'string' ||
			!Number.isFinite(Date.parse(validation.validated_at))
		) {
			throw new PatientExportOrchestrationError('EXPORT_DEPENDENCY_UNAVAILABLE');
		}
		datasetValidated = true;

		assertNotCancelled(options.signal);
		const workbookClient = await import('./client');
		const buildPromise = workbookClient.buildPatientExportXlsx(
			{ session, datasets, generatedAtUtc: new Date().toISOString() },
			{
				signal: options.signal,
				onProgress: (phase) => options.onProgress?.({ stage: phase, attempt })
			}
		);
		// El Worker ya recibio una copia estructurada. Soltar la referencia del
		// orquestador evita retener dos datasets completos durante la compresion.
		datasets = emptyDatasetRows();
		let result: Awaited<ReturnType<typeof workbookClient.buildPatientExportXlsx>>;
		try {
			result = await buildPromise;
		} catch (error) {
			if (error instanceof workbookClient.PatientExportBuildCancelledError) {
				throw new PatientExportOrchestrationError('EXPORT_CANCELLED', { cause: error });
			}
			if (error instanceof workbookClient.PatientExportBuildError) {
				throw new PatientExportOrchestrationError('EXPORT_WORKBOOK_FAILED', {
					message: error.message,
					cause: error
				});
			}
			throw error;
		}
		options.onSessionCancelChange?.(null);
		return { ...result, counts: receivedCounts, scope: options.scope };
	} catch (error) {
		const normalized = normalizeUnexpectedError(error, options.signal);
		if (
			exportId &&
			requestSessionCancellation &&
			(!datasetValidated || normalized.code === 'EXPORT_CANCELLED')
		) {
			await requestSessionCancellation();
		}
		options.onSessionCancelChange?.(null);
		throw normalized;
	}
};

export const preparePatientExport = async (
	options: PreparePatientExportOptions
): Promise<PreparedPatientExport> => {
	try {
		return await runAttempt(options, 1);
	} catch (error) {
		const normalized = normalizeUnexpectedError(error, options.signal);
		if (normalized.code !== 'EXPORT_DATA_CHANGED' || options.signal?.aborted) throw normalized;
		options.onProgress?.({ stage: 'retrying', attempt: 2 });
		return runAttempt(options, 2);
	}
};

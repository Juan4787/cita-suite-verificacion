import { PATIENT_EXPORT_XLSX_MIME, type PatientExportWorkbookInput } from './workbook';
import type {
	PatientExportWorkerErrorCode,
	PatientExportWorkerProgressPhase,
	PatientExportWorkerRequest
} from './worker-protocol';

export type PatientExportBuildResult = {
	blob: Blob;
	filename: string;
	byteLength: number;
};

export class PatientExportBuildError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PatientExportBuildError';
	}
}

export class PatientExportBuildCancelledError extends Error {
	constructor() {
		super('La exportación fue cancelada.');
		this.name = 'PatientExportBuildCancelledError';
	}
}

type WorkerLike = Pick<
	Worker,
	'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'
>;

export type PatientExportBuildOptions = {
	signal?: AbortSignal;
	onProgress?: (phase: PatientExportWorkerProgressPhase) => void;
	workerFactory?: () => WorkerLike;
};

const WORKER_ERROR_MESSAGES: Record<PatientExportWorkerErrorCode, string> = {
	WORKBOOK_INVALID: 'No pudimos construir el archivo Excel. Volvé a preparar la exportación.',
	WORKBOOK_INCOMPLETE:
		'No pudimos comprobar que el archivo estuviera completo. Volvé a prepararlo.',
	TEXT_INVALID:
		'Uno de los textos contiene caracteres que no se pueden exportar. Revisalo y volvé a intentar.',
	WORKBOOK_UNEXPECTED: 'No pudimos crear el archivo Excel. Volvé a intentarlo.'
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isWorkerErrorCode = (value: unknown): value is PatientExportWorkerErrorCode =>
	typeof value === 'string' && Object.hasOwn(WORKER_ERROR_MESSAGES, value);

const isProgressPhase = (value: unknown): value is PatientExportWorkerProgressPhase =>
	value === 'transforming' || value === 'writing';

const createWorker = (): WorkerLike =>
	new Worker(new URL('./patient-export.worker.ts', import.meta.url), {
		type: 'module',
		name: 'cita-suite-patient-export'
	});

export const buildPatientExportXlsx = (
	input: PatientExportWorkbookInput,
	options: PatientExportBuildOptions = {}
): Promise<PatientExportBuildResult> => {
	if (options.signal?.aborted) return Promise.reject(new PatientExportBuildCancelledError());

	let worker: WorkerLike;
	try {
		worker = (options.workerFactory ?? createWorker)();
	} catch (error) {
		return Promise.reject(
			new PatientExportBuildError('No pudimos iniciar la creación del archivo. Volvé a intentarlo.')
		);
	}

	const requestId = crypto.randomUUID();
	return new Promise((resolve, reject) => {
		let settled = false;

		const cleanup = () => {
			worker.removeEventListener('message', onMessage as EventListener);
			worker.removeEventListener('error', onWorkerError as EventListener);
			options.signal?.removeEventListener('abort', onAbort);
			worker.terminate();
		};

		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};

		const onAbort = () => {
			finish(() => reject(new PatientExportBuildCancelledError()));
		};

		const onWorkerError = (event: Event) => {
			if ('preventDefault' in event) event.preventDefault();
			finish(() =>
				reject(new PatientExportBuildError('No pudimos crear el archivo Excel. Volvé a intentarlo.'))
			);
		};

		const onMessage = (event: MessageEvent<unknown>) => {
			const message = event.data;
			if (!isRecord(message) || message.requestId !== requestId) return;

			if (message.type === 'progress' && isProgressPhase(message.phase)) {
				options.onProgress?.(message.phase);
				return;
			}

			if (
				message.type === 'success' &&
				typeof message.filename === 'string' &&
				/^datos-paciente(?:s)?-\d{8}-\d{4}\.xlsx$/.test(message.filename) &&
				message.mimeType === PATIENT_EXPORT_XLSX_MIME &&
				message.buffer instanceof ArrayBuffer &&
				Number.isSafeInteger(message.byteLength) &&
				message.byteLength === message.buffer.byteLength
			) {
				const result: PatientExportBuildResult = {
					blob: new Blob([message.buffer], { type: PATIENT_EXPORT_XLSX_MIME }),
					filename: message.filename,
					byteLength: message.byteLength
				};
				finish(() => resolve(result));
				return;
			}

			if (message.type === 'error' && isWorkerErrorCode(message.code)) {
				const errorCode = message.code;
				finish(() => reject(new PatientExportBuildError(WORKER_ERROR_MESSAGES[errorCode])));
				return;
			}

			finish(() =>
				reject(new PatientExportBuildError('No pudimos crear el archivo Excel. Volvé a intentarlo.'))
			);
		};

		worker.addEventListener('message', onMessage as EventListener);
		worker.addEventListener('error', onWorkerError as EventListener);
		options.signal?.addEventListener('abort', onAbort, { once: true });

		const request: PatientExportWorkerRequest = { type: 'build', requestId, input };
		try {
			worker.postMessage(request);
		} catch (error) {
			finish(() =>
				reject(
					new PatientExportBuildError(
						'No pudimos enviar los datos al generador del archivo. Volvé a intentarlo.'
					)
				)
			);
		}
	});
};

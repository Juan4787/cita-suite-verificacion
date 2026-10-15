import { describe, expect, it, vi } from 'vitest';
import {
	PatientExportBuildCancelledError,
	PatientExportBuildError,
	buildPatientExportXlsx
} from './client';
import { makePatientExportWorkbookInput } from './test-fixtures';
import type { PatientExportWorkerRequest, PatientExportWorkerResponse } from './worker-protocol';

class FakeWorker {
	private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	lastRequest: PatientExportWorkerRequest | null = null;
	terminate = vi.fn();

	postMessage = vi.fn((message: PatientExportWorkerRequest) => {
		this.lastRequest = message;
	});

	addEventListener = (type: string, listener: EventListenerOrEventListenerObject) => {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	};

	removeEventListener = (type: string, listener: EventListenerOrEventListenerObject) => {
		this.listeners.get(type)?.delete(listener);
	};

	emitMessage(message: PatientExportWorkerResponse | Record<string, unknown>) {
		this.emit('message', { data: message } as MessageEvent);
	}

	emitError() {
		this.emit('error', { preventDefault: vi.fn() } as unknown as Event);
	}

	private emit(type: string, event: Event) {
		for (const listener of this.listeners.get(type) ?? []) {
			if (typeof listener === 'function') listener(event);
			else listener.handleEvent(event);
		}
	}
}

const fakeFactory = (worker: FakeWorker) => () => worker as unknown as Worker;

describe('patient export worker client', () => {
	it('reports stages, accepts only a valid result and always terminates the worker', async () => {
		const worker = new FakeWorker();
		const onProgress = vi.fn();
		const resultPromise = buildPatientExportXlsx(makePatientExportWorkbookInput(), {
			workerFactory: fakeFactory(worker),
			onProgress
		});
		const requestId = worker.lastRequest!.requestId;

		worker.emitMessage({ type: 'progress', requestId, phase: 'transforming' });
		worker.emitMessage({ type: 'progress', requestId, phase: 'writing' });
		const buffer = new Uint8Array([1, 2, 3]).buffer;
		worker.emitMessage({
			type: 'success',
			requestId,
			filename: 'datos-pacientes-20260828-1435.xlsx',
			mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			buffer,
			byteLength: 3
		});

		const result = await resultPromise;
		expect(onProgress.mock.calls.map(([phase]) => phase)).toEqual(['transforming', 'writing']);
		expect(result.filename).toBe('datos-pacientes-20260828-1435.xlsx');
		expect(result.blob.type).toBe(
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
		expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('terminates immediately when the caller cancels', async () => {
		const worker = new FakeWorker();
		const controller = new AbortController();
		const resultPromise = buildPatientExportXlsx(makePatientExportWorkbookInput(), {
			workerFactory: fakeFactory(worker),
			signal: controller.signal
		});

		controller.abort();
		await expect(resultPromise).rejects.toBeInstanceOf(PatientExportBuildCancelledError);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('maps worker codes to human messages and never exposes malformed details', async () => {
		const codedWorker = new FakeWorker();
		const codedPromise = buildPatientExportXlsx(makePatientExportWorkbookInput(), {
			workerFactory: fakeFactory(codedWorker)
		});
		codedWorker.emitMessage({
			type: 'error',
			requestId: codedWorker.lastRequest!.requestId,
			code: 'WORKBOOK_INCOMPLETE'
		});
		await expect(codedPromise).rejects.toMatchObject({
			message: 'No pudimos comprobar que el archivo estuviera completo. Volvé a prepararlo.'
		});

		const malformedWorker = new FakeWorker();
		const malformedPromise = buildPatientExportXlsx(makePatientExportWorkbookInput(), {
			workerFactory: fakeFactory(malformedWorker)
		});
		malformedWorker.emitMessage({
			type: 'error',
			requestId: malformedWorker.lastRequest!.requestId,
			code: 'SQLSTATE 42501: private table missing'
		});
		await expect(malformedPromise).rejects.toSatisfy((error: unknown) => {
			expect(error).toBeInstanceOf(PatientExportBuildError);
			expect((error as Error).message).not.toMatch(/SQL|42501|private table/i);
			return true;
		});
	});

	it('normalizes worker startup and runtime failures', async () => {
		await expect(
			buildPatientExportXlsx(makePatientExportWorkbookInput(), {
				workerFactory: () => {
					throw new Error('CSP worker-src');
				}
			})
		).rejects.toMatchObject({
			message: 'No pudimos iniciar la creación del archivo. Volvé a intentarlo.'
		});

		const worker = new FakeWorker();
		const promise = buildPatientExportXlsx(makePatientExportWorkbookInput(), {
			workerFactory: fakeFactory(worker)
		});
		worker.emitError();
		await expect(promise).rejects.toMatchObject({
			message: 'No pudimos crear el archivo Excel. Volvé a intentarlo.'
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
});

/// <reference lib="webworker" />

import writeXlsxFile from 'write-excel-file/browser';
import { PatientExportTextError } from './ooxml';
import {
	PatientExportWorkbookError,
	buildPatientExportWorkbook
} from './workbook';
import type {
	PatientExportWorkerErrorCode,
	PatientExportWorkerRequest,
	PatientExportWorkerResponse
} from './worker-protocol';
import { toPatientExportWritableSheets } from './xlsx-adapter';

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
let busy = false;

const respond = (message: PatientExportWorkerResponse, transfer?: Transferable[]) => {
	workerScope.postMessage(message, transfer ?? []);
};

const safeFailureCode = (error: unknown): PatientExportWorkerErrorCode => {
	if (error instanceof PatientExportTextError) return 'TEXT_INVALID';
	if (error instanceof PatientExportWorkbookError) return error.code;
	return 'WORKBOOK_UNEXPECTED';
};

workerScope.addEventListener('message', async (event: MessageEvent<PatientExportWorkerRequest>) => {
	const request = event.data;
	if (
		busy ||
		request?.type !== 'build' ||
		typeof request.requestId !== 'string' ||
		request.requestId.length === 0
	) {
		const requestId = typeof request?.requestId === 'string' ? request.requestId : 'invalid';
		respond({
			type: 'error',
			requestId,
			code: 'WORKBOOK_INVALID'
		});
		return;
	}

	busy = true;
	try {
		respond({ type: 'progress', requestId: request.requestId, phase: 'transforming' });
		const workbook = buildPatientExportWorkbook(request.input);
		const sheets = toPatientExportWritableSheets(workbook);

		respond({ type: 'progress', requestId: request.requestId, phase: 'writing' });
		const blob = await writeXlsxFile(sheets).toBlob();
		const buffer = await blob.arrayBuffer();
		respond(
			{
				type: 'success',
				requestId: request.requestId,
				filename: workbook.filename,
				mimeType: workbook.mimeType,
				buffer,
				byteLength: buffer.byteLength
			},
			[buffer]
		);
	} catch (error) {
		console.error('Fallo al construir exportación XLSX', {
			name: error instanceof Error ? error.name : typeof error
		});
		respond({
			type: 'error',
			requestId: request.requestId,
			code: safeFailureCode(error)
		});
	} finally {
		busy = false;
		workerScope.close();
	}
});

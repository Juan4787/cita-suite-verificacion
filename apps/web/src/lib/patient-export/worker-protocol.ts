import type { PatientExportWorkbookInput } from './workbook';

export type PatientExportWorkerRequest = {
	type: 'build';
	requestId: string;
	input: PatientExportWorkbookInput;
};

export type PatientExportWorkerProgressPhase = 'transforming' | 'writing';
export type PatientExportWorkerErrorCode =
	| 'WORKBOOK_INVALID'
	| 'WORKBOOK_INCOMPLETE'
	| 'TEXT_INVALID'
	| 'WORKBOOK_UNEXPECTED';

export type PatientExportWorkerResponse =
	| {
			type: 'progress';
			requestId: string;
			phase: PatientExportWorkerProgressPhase;
	  }
	| {
			type: 'success';
			requestId: string;
			filename: string;
			mimeType: string;
			buffer: ArrayBuffer;
			byteLength: number;
	  }
	| {
			type: 'error';
			requestId: string;
			code: PatientExportWorkerErrorCode;
	  };

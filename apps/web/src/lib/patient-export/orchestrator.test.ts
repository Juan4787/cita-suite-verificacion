import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	PATIENT_EXPORT_DATASETS,
	PATIENT_EXPORT_SCHEMA_VERSION,
	emptyPatientExportCounts,
	type PatientExportCounts,
	type PatientExportDataset
} from './contract';

const clientMocks = vi.hoisted(() => ({ buildPatientExportXlsx: vi.fn() }));

vi.mock('./client', () => {
	class PatientExportBuildError extends Error {}
	class PatientExportBuildCancelledError extends Error {}
	return {
		buildPatientExportXlsx: clientMocks.buildPatientExportXlsx,
		PatientExportBuildError,
		PatientExportBuildCancelledError
	};
});

import {
	PatientExportOrchestrationError,
	preparePatientExport,
	type PatientExportProgress
} from './orchestrator';

const EXPORT_IDS = [
	'11111111-1111-4111-8111-111111111111',
	'22222222-2222-4222-8222-222222222222'
];
const PATIENT_ID = '33333333-3333-4333-8333-333333333333';

const jsonResponse = (
	body: unknown,
	status = 200,
	headers: Record<string, string> = {}
) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});

const sessionResponse = (
	exportId: string,
	counts: PatientExportCounts,
	scope: 'patient' | 'all_patients' = 'all_patients'
) => ({
	reused: false,
	export_id: exportId,
	scope,
	patient_id: scope === 'patient' ? PATIENT_ID : null,
	schema_version: PATIENT_EXPORT_SCHEMA_VERSION,
	expected_counts: counts,
	datasets: [...PATIENT_EXPORT_DATASETS],
	business: { name: 'Consultorio', timezone: 'America/Argentina/Buenos_Aires' },
	expires_at: '2026-08-29T00:00:00.000Z'
});

const pageResponse = ({
	exportId,
	dataset,
	rows = [],
	nextCursor = null,
	done = true
}: {
	exportId: string;
	dataset: PatientExportDataset;
	rows?: Record<string, unknown>[];
	nextCursor?: string | null;
	done?: boolean;
}) => ({
	export_id: exportId,
	dataset,
	rows,
	row_count: rows.length,
	next_cursor: nextCursor,
	done,
	expires_at: '2026-08-29T00:00:00.000Z'
});

const fetchType = (mock: ReturnType<typeof vi.fn>) => mock as unknown as typeof fetch;

describe('patient export HTTP orchestrator', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clientMocks.buildPatientExportXlsx.mockImplementation(
			async (_input: unknown, options?: { onProgress?: (phase: 'transforming' | 'writing') => void }) => {
				options?.onProgress?.('transforming');
				options?.onProgress?.('writing');
				return {
					blob: new Blob(['xlsx'], {
						type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
					}),
					filename: 'datos-pacientes-20260828-1435.xlsx',
					byteLength: 4
				};
			}
		);
	});

	it('fetches every dataset sequentially, validates exact counts and only then builds', async () => {
		const counts = { ...emptyPatientExportCounts(), patients: 2 };
		const progress: PatientExportProgress[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/odonto/exportaciones' && init?.method === 'POST') {
				return jsonResponse(sessionResponse(EXPORT_IDS[0]!, counts));
			}
			if (url.endsWith('/validaciones')) {
				return jsonResponse({ validated: true, validated_at: '2026-08-28T14:34:00.000Z' });
			}
			const match = /\/hojas\/([^?]+)/.exec(url);
			if (match) {
				const dataset = match[1] as PatientExportDataset;
				if (dataset === 'patients' && !url.includes('?cursor=')) {
					return jsonResponse(
						pageResponse({
							exportId: EXPORT_IDS[0]!,
							dataset,
							rows: [{ patient_id: 'patient-1' }],
							nextCursor: 'cursor_1',
							done: false
						})
					);
				}
				return jsonResponse(
					pageResponse({
						exportId: EXPORT_IDS[0]!,
						dataset,
						rows: dataset === 'patients' ? [{ patient_id: 'patient-2' }] : []
					})
				);
			}
			throw new Error(`Unexpected request ${init?.method} ${url}`);
		});

		const result = await preparePatientExport({
			scope: 'all_patients',
			fetchImpl: fetchType(fetchMock),
			onProgress: (state) => progress.push(state)
		});

		expect(result.counts).toEqual(counts);
		expect(clientMocks.buildPatientExportXlsx).toHaveBeenCalledOnce();
		expect(clientMocks.buildPatientExportXlsx.mock.calls[0]?.[0]).toMatchObject({
			session: { export_id: EXPORT_IDS[0] },
			datasets: { patients: [{ patient_id: 'patient-1' }, { patient_id: 'patient-2' }] }
		});
		const validationCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/validaciones'));
		expect(JSON.parse(String(validationCall?.[1]?.body))).toEqual({ received_counts: counts });
		expect(progress.at(-1)).toMatchObject({ stage: 'writing', attempt: 1 });
		expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/hojas/'))).toHaveLength(7);
	});

	it('cancels the server session and terminates before validation when the caller aborts', async () => {
		const counts = { ...emptyPatientExportCounts(), patients: 1 };
		const controller = new AbortController();
		const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url = String(input);
			if (url === '/api/odonto/exportaciones') {
				return Promise.resolve(jsonResponse(sessionResponse(EXPORT_IDS[0]!, counts)));
			}
			if (init?.method === 'DELETE') {
				return Promise.resolve(jsonResponse({ status: 'cancelled' }));
			}
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => reject(new DOMException('Aborted', 'AbortError')),
					{ once: true }
				);
			});
		});
		const promise = preparePatientExport({
			scope: 'all_patients',
			fetchImpl: fetchType(fetchMock),
			signal: controller.signal
		});
		await vi.waitFor(() =>
			expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/hojas/patients'))).toBe(true)
		);
		controller.abort();

		await expect(promise).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
		expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
		expect(clientMocks.buildPatientExportXlsx).not.toHaveBeenCalled();
	});

	it('exposes an idempotent keepalive cancellation as soon as the session starts', async () => {
		const counts = { ...emptyPatientExportCounts(), patients: 1 };
		const controller = new AbortController();
		let cancelFromLifecycle: (() => void) | null = null;
		const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url = String(input);
			if (url === '/api/odonto/exportaciones') {
				return Promise.resolve(jsonResponse(sessionResponse(EXPORT_IDS[0]!, counts)));
			}
			if (init?.method === 'DELETE') {
				return Promise.resolve(jsonResponse({ status: 'cancelled' }));
			}
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => reject(new DOMException('Aborted', 'AbortError')),
					{ once: true }
				);
			});
		});
		const promise = preparePatientExport({
			scope: 'all_patients',
			fetchImpl: fetchType(fetchMock),
			signal: controller.signal,
			onSessionCancelChange: (cancel) => (cancelFromLifecycle = cancel)
		});
		await vi.waitFor(() => expect(cancelFromLifecycle).toBeTypeOf('function'));

		(cancelFromLifecycle as (() => void) | null)?.();
		await vi.waitFor(() =>
			expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
		);
		controller.abort();

		await expect(promise).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
		expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
		expect(cancelFromLifecycle).toBeNull();
	});

	it('fails closed on missing rows or repeated cursors and releases the global lock', async () => {
		const counts = { ...emptyPatientExportCounts(), patients: 1 };
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/odonto/exportaciones') {
				return jsonResponse(sessionResponse(EXPORT_IDS[0]!, counts));
			}
			if (init?.method === 'DELETE') return jsonResponse({ status: 'cancelled' });
			if (url.includes('/hojas/patients')) {
				return jsonResponse(
					pageResponse({ exportId: EXPORT_IDS[0]!, dataset: 'patients', rows: [] })
				);
			}
			throw new Error(`Unexpected request ${url}`);
		});

		await expect(
			preparePatientExport({ scope: 'all_patients', fetchImpl: fetchType(fetchMock) })
		).rejects.toMatchObject({ code: 'EXPORT_COUNT_MISMATCH' });
		expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
		expect(clientMocks.buildPatientExportXlsx).not.toHaveBeenCalled();
	});

	it('restarts the entire export once when the consistency fingerprint changes', async () => {
		const counts = emptyPatientExportCounts();
		let starts = 0;
		let validations = 0;
		const progress: PatientExportProgress[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/odonto/exportaciones') {
				const exportId = EXPORT_IDS[starts++]!;
				return jsonResponse(sessionResponse(exportId, counts));
			}
			if (init?.method === 'DELETE') return jsonResponse({ status: 'failed' });
			if (url.endsWith('/validaciones')) {
				validations += 1;
				return validations === 1
					? jsonResponse({
							error: {
								code: 'EXPORT_DATA_CHANGED',
								message: 'technical message must be ignored'
							}
						}, 409)
					: jsonResponse({ validated: true, validated_at: '2026-08-28T14:34:00.000Z' });
			}
			const dataset = /\/hojas\/([^?]+)/.exec(url)?.[1] as PatientExportDataset;
			const exportId = url.includes(EXPORT_IDS[0]!) ? EXPORT_IDS[0]! : EXPORT_IDS[1]!;
			return jsonResponse(pageResponse({ exportId, dataset }));
		});

		await expect(
			preparePatientExport({
				scope: 'all_patients',
				fetchImpl: fetchType(fetchMock),
				onProgress: (state) => progress.push(state)
			})
		).resolves.toMatchObject({ counts });
		expect(starts).toBe(2);
		expect(validations).toBe(2);
		expect(progress).toContainEqual({ stage: 'retrying', attempt: 2 });
		expect(clientMocks.buildPatientExportXlsx).toHaveBeenCalledOnce();
	});

	it('reuses the same idempotency key for a single start transport retry', async () => {
		const counts = emptyPatientExportCounts();
		const startBodies: string[] = [];
		let starts = 0;
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/odonto/exportaciones') {
				startBodies.push(String(init?.body));
				starts += 1;
				if (starts === 1) throw new TypeError('response lost');
				return jsonResponse(sessionResponse(EXPORT_IDS[0]!, counts));
			}
			if (url.endsWith('/validaciones')) {
				return jsonResponse({ validated: true, validated_at: '2026-08-28T14:34:00.000Z' });
			}
			const dataset = /\/hojas\/([^?]+)/.exec(url)?.[1] as PatientExportDataset;
			return jsonResponse(pageResponse({ exportId: EXPORT_IDS[0]!, dataset }));
		});

		await preparePatientExport({ scope: 'all_patients', fetchImpl: fetchType(fetchMock) });
		expect(startBodies).toHaveLength(2);
		expect(JSON.parse(startBodies[0]!).request_key).toBe(JSON.parse(startBodies[1]!).request_key);
	});

	it('caps exceptional responses and never exposes untrusted server details', async () => {
		const counts = { ...emptyPatientExportCounts(), patients: 1 };
		const oversizedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/odonto/exportaciones') {
				return jsonResponse(sessionResponse(EXPORT_IDS[0]!, counts));
			}
			if (init?.method === 'DELETE') return jsonResponse({ status: 'cancelled' });
			return jsonResponse(
				pageResponse({ exportId: EXPORT_IDS[0]!, dataset: 'patients' }),
				200,
				{ 'content-length': String(33 * 1024 * 1024) }
			);
		});
		await expect(
			preparePatientExport({ scope: 'all_patients', fetchImpl: fetchType(oversizedFetch) })
		).rejects.toMatchObject({ code: 'EXPORT_RESPONSE_TOO_LARGE' });

		const unsafeFetch = vi.fn().mockResolvedValue(
			jsonResponse(
				{ error: { code: 'SQLSTATE_42501', message: 'private.patient_export_sessions missing' } },
				500
			)
		);
		await expect(
			preparePatientExport({ scope: 'all_patients', fetchImpl: fetchType(unsafeFetch) })
		).rejects.toSatisfy((error: unknown) => {
			expect(error).toBeInstanceOf(PatientExportOrchestrationError);
			expect((error as Error).message).not.toMatch(/SQL|42501|private|patient_export_sessions/i);
			return true;
		});
	});

	it('rejects an invalid individual scope before any request', async () => {
		const fetchMock = vi.fn();
		await expect(
			preparePatientExport({
				scope: 'patient',
				patientId: 'not-a-patient-id',
				fetchImpl: fetchType(fetchMock)
			})
		).rejects.toMatchObject({ code: 'EXPORT_INVALID_REQUEST' });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

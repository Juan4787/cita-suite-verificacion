/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PatientExportPanel from './PatientExportPanel.svelte';

const exportMocks = vi.hoisted(() => ({ preparePatientExport: vi.fn() }));

vi.mock('$lib/patient-export/orchestrator', () => ({
	preparePatientExport: exportMocks.preparePatientExport
}));

const counts = {
	patients: 2,
	custom_fields: 3,
	clinical_entries: 4,
	appointments: 5,
	appointment_professionals: 6,
	follow_ups: 7
};

const result = () => ({
	blob: new Blob(['xlsx']),
	filename: 'datos-pacientes-20260828-1435.xlsx',
	byteLength: 4,
	counts,
	scope: 'all_patients' as const
});

const exportError = (code: string, message: string, retryable: boolean) =>
	Object.assign(new Error(message), {
		name: 'PatientExportOrchestrationError',
		code,
		retryable
	});

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.clearAllMocks();
	createObjectURL = vi.fn(() => `blob:export-${createObjectURL.mock.calls.length}`);
	revokeObjectURL = vi.fn();
	Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
	Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
	anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('panel de exportación de pacientes', () => {
	it('no carga ni inicia la exportación hasta la decisión explícita del usuario', () => {
		render(PatientExportPanel, { scope: 'all_patients' });
		expect(screen.getByRole('button', { name: 'Preparar archivo Excel' })).toBeInTheDocument();
		expect(exportMocks.preparePatientExport).not.toHaveBeenCalled();
	});

	it('bloquea el doble clic y crea una sola operación', async () => {
		let finish!: (value: ReturnType<typeof result>) => void;
		exportMocks.preparePatientExport.mockImplementation(
			() => new Promise((resolve) => (finish = resolve))
		);
		render(PatientExportPanel, { scope: 'all_patients' });
		const button = screen.getByRole('button', { name: 'Preparar archivo Excel' });

		await Promise.all([fireEvent.click(button), fireEvent.click(button)]);
		await waitFor(() => expect(exportMocks.preparePatientExport).toHaveBeenCalledOnce());
		finish(result());
		await screen.findByText('Archivo listo');
	});

	it('muestra progreso real y cancela la sesión al pedirlo', async () => {
		const receivedSignal = { current: null as AbortSignal | null };
		const cancelServerSession = vi.fn();
		exportMocks.preparePatientExport.mockImplementation(
			({
				signal,
				onProgress,
				onSessionCancelChange
			}: {
				signal: AbortSignal;
				onProgress: (value: unknown) => void;
				onSessionCancelChange: (cancel: (() => void) | null) => void;
			}) => {
				receivedSignal.current = signal;
				onSessionCancelChange(cancelServerSession);
				onProgress({
					stage: 'fetching',
					attempt: 1,
					dataset: 'clinical_entries',
					received: 12,
					expected: 30
				});
				return new Promise((_resolve, reject) => {
					signal.addEventListener(
						'abort',
						() => reject(exportError('EXPORT_CANCELLED', 'La exportación fue cancelada.', false)),
						{ once: true }
					);
				});
			}
		);
		render(PatientExportPanel, { scope: 'all_patients' });

		await fireEvent.click(screen.getByRole('button', { name: 'Preparar archivo Excel' }));
		expect(await screen.findByText('Historia clínica: 12 de 30 registros.')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

		const summary = await screen.findByText('Exportación cancelada');
		expect(receivedSignal.current?.aborted).toBe(true);
		expect(cancelServerSession).toHaveBeenCalledOnce();
		expect(summary.closest('[role="status"]')).toHaveFocus();
		expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
	});

	it('descarga automáticamente, permite repetir y revoca todas las URL temporales', async () => {
		exportMocks.preparePatientExport.mockResolvedValue(result());
		const view = render(PatientExportPanel, { scope: 'all_patients' });

		await fireEvent.click(screen.getByRole('button', { name: 'Preparar archivo Excel' }));
		const summary = await screen.findByText('Archivo listo');
		await waitFor(() => expect(summary.closest('[role="status"]')).toHaveFocus());
		expect(createObjectURL).toHaveBeenCalledOnce();
		expect(anchorClick).toHaveBeenCalledOnce();
		expect(screen.getByText('2')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Descargar otra vez' }));
		expect(createObjectURL).toHaveBeenCalledTimes(2);
		expect(anchorClick).toHaveBeenCalledTimes(2);
		view.unmount();
		expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual([
			'blob:export-1',
			'blob:export-2'
		]);
	});

	it('muestra sólo errores humanos y ofrece únicamente acciones válidas', async () => {
		exportMocks.preparePatientExport.mockRejectedValueOnce(
			exportError(
				'EXPORT_DEPENDENCY_UNAVAILABLE',
				'No pudimos leer todos los datos en este momento. Intentá nuevamente en unos minutos.',
				true
			)
		);
		render(PatientExportPanel, { scope: 'all_patients' });
		await fireEvent.click(screen.getByRole('button', { name: 'Preparar archivo Excel' }));

		const alert = await screen.findByRole('alert');
		await waitFor(() => expect(alert).toHaveFocus());
		expect(alert).toHaveTextContent('No pudimos leer todos los datos');
		expect(screen.getByRole('button', { name: 'Intentar nuevamente' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();

		cleanup();
		exportMocks.preparePatientExport.mockRejectedValueOnce(
			new Error('SQLSTATE 42501 private_table UUID 11111111-1111-4111-8111-111111111111')
		);
		render(PatientExportPanel, { scope: 'all_patients' });
		await fireEvent.click(screen.getByRole('button', { name: 'Preparar archivo Excel' }));
		await waitFor(() => {
			expect(screen.getByRole('alert')).not.toHaveTextContent(/SQLSTATE|42501|private_table|11111111/);
		});
	});

	it('cancela una preparación pendiente al abandonar la pantalla', async () => {
		const receivedSignal = { current: null as AbortSignal | null };
		const cancelServerSession = vi.fn();
		exportMocks.preparePatientExport.mockImplementation(
			({
				signal,
				onSessionCancelChange
			}: {
				signal: AbortSignal;
				onSessionCancelChange: (cancel: (() => void) | null) => void;
			}) => {
				receivedSignal.current = signal;
				onSessionCancelChange(cancelServerSession);
				return new Promise(() => undefined);
			}
		);
		const view = render(PatientExportPanel, {
			scope: 'patient',
			patientId: '22222222-2222-4222-8222-222222222222',
			patientName: 'Paciente de prueba'
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Preparar archivo Excel' }));
		await waitFor(() => expect(receivedSignal.current).not.toBeNull());

		view.unmount();
		expect(receivedSignal.current?.aborted).toBe(true);
		expect(cancelServerSession).toHaveBeenCalledOnce();
	});

	it('cancela la sesión en pagehide antes de una recarga o cierre', async () => {
		const receivedSignal = { current: null as AbortSignal | null };
		const cancelServerSession = vi.fn();
		exportMocks.preparePatientExport.mockImplementation(
			({
				signal,
				onSessionCancelChange
			}: {
				signal: AbortSignal;
				onSessionCancelChange: (cancel: (() => void) | null) => void;
			}) => {
				receivedSignal.current = signal;
				onSessionCancelChange(cancelServerSession);
				return new Promise(() => undefined);
			}
		);
		const view = render(PatientExportPanel, { scope: 'all_patients' });
		await fireEvent.click(screen.getByRole('button', { name: 'Preparar archivo Excel' }));
		await waitFor(() => expect(receivedSignal.current).not.toBeNull());

		window.dispatchEvent(new Event('pagehide'));
		expect(receivedSignal.current?.aborted).toBe(true);
		expect(cancelServerSession).toHaveBeenCalledOnce();
		expect(await screen.findByText('Exportación cancelada')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();

		view.unmount();
		expect(cancelServerSession).toHaveBeenCalledOnce();
	});
});

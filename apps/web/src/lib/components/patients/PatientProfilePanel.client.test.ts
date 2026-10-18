/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PatientProfilePanel from './PatientProfilePanel.svelte';
import type { PatientPermissions } from '$lib/patients/contracts';
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

const permissions: PatientPermissions = {
	canReadClinicalHistory: true,
	canReadClinicalProfile: true,
	canEditClinicalProfile: true,
	canViewCosts: true,
	canEditPatient: true,
	canArchivePatient: true,
	canCreateClinicalEntry: true,
	canEditClinicalEntry: true,
	canCreateAppointment: true,
	canViewRadiographs: true,
	canUploadRadiographs: true,
	canViewRadiographTrash: true,
	canTrashRadiographs: true,
	canExportPatientData: true
};
const event = {
	id: 'event-one',
	summary: 'Synthetic previous update',
	changed_by_name: 'Synthetic actor',
	created_at: '2026-01-01T12:00:00Z'
};
const props = () => ({
	active: false,
	patient: {
		id: 'patient-one',
		full_name: 'Synthetic profile',
		updated_at: '2026-01-01T12:00:00Z'
	},
	permissions,
	scope: 'owner-one',
	deferred: true,
	demo: false,
	onEdit: vi.fn()
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
	else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('patient profile deferred changes', () => {
	it('does not present hidden clinical information as unregistered to basic roles', () => {
		render(PatientProfilePanel, {
			...props(),
			active: true,
			deferred: false,
			permissions: { ...permissions, canReadClinicalProfile: false, canEditClinicalProfile: false },
			patient: { ...props().patient, allergies: 'PRIVATE_CLINICAL_SENTINEL' }
		});
		expect(screen.queryByText('Alertas médicas')).not.toBeInTheDocument();
		expect(screen.queryByText('PRIVATE_CLINICAL_SENTINEL')).not.toBeInTheDocument();
		expect(screen.getByText('Contacto')).toBeInTheDocument();
	});
	it('reports an unavailable clipboard and still leaves the contact visible', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: vi.fn().mockRejectedValue(new Error('PRIVATE_SENTINEL')) }
		});
		render(PatientProfilePanel, {
			...props(),
			active: true,
			deferred: false,
			patient: { ...props().patient, phone: '123456789' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Copiar teléfono' }));
		expect(await screen.findByRole('status')).toHaveTextContent(
			'Seleccionalo y copialo manualmente.'
		);
		expect(screen.getByRole('status')).not.toHaveTextContent('PRIVATE_SENTINEL');
		expect(screen.getByText('123456789')).toBeInTheDocument();
	});
	it('loads changes only when opened and keeps the same result across tab navigation', async () => {
		const fetcher = vi.fn().mockResolvedValue(Response.json({ change_events: [event] }));
		vi.stubGlobal('fetch', fetcher);
		const view = render(PatientProfilePanel, props());
		expect(fetcher).not.toHaveBeenCalled();
		await view.rerender({ active: true });
		expect(await screen.findByText(event.summary)).toBeInTheDocument();
		await view.rerender({ active: false });
		await view.rerender({ active: true });
		expect(screen.getByText(event.summary)).toBeInTheDocument();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it('shows recovery after a partial success without repeatedly fetching in an effect', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(Response.json({}))
			.mockResolvedValueOnce(Response.json({ change_events: [event] }));
		vi.stubGlobal('fetch', fetcher);
		render(PatientProfilePanel, { ...props(), active: true });
		expect(
			await screen.findByText('No pudimos cargar los últimos cambios. Volvé a intentar.')
		).toBeInTheDocument();
		expect(fetcher).toHaveBeenCalledTimes(1);
		await fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
		expect(await screen.findByText(event.summary)).toBeInTheDocument();
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
	it('aborts and discards an earlier patient response after navigation', async () => {
		let finish!: (value: Response) => void;
		const fetcher = vi
			.fn()
			.mockReturnValueOnce(
				new Promise<Response>((resolve) => {
					finish = resolve;
				})
			)
			.mockResolvedValueOnce(Response.json({ change_events: [] }));
		vi.stubGlobal('fetch', fetcher);
		const view = render(PatientProfilePanel, { ...props(), active: true });
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
		await view.rerender({
			patient: { ...props().patient, id: 'patient-two', full_name: 'Other profile' }
		});
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
		finish(Response.json({ change_events: [event] }));
		await waitFor(() =>
			expect(screen.queryByText('Cargando últimos cambios…')).not.toBeInTheDocument()
		);
		expect(screen.getByText('Other profile')).toBeInTheDocument();
		expect(screen.queryByText(event.summary)).not.toBeInTheDocument();
	});
});

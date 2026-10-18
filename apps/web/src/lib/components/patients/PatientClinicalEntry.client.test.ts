/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PatientPage from '../../../routes/odonto/pacientes/[id]/+page.svelte';
import type { PatientDetailViewData } from '$lib/patients/contracts';

vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({ url: new URL('https://app.test/odonto/pacientes/synthetic'), state: {} })
	};
});
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(), replaceState: vi.fn() }));
afterEach(cleanup);

describe('actual patient clinical editor submission', () => {
	it('does not multiply an existing fractional clinical amount when editing only the description', async () => {
		const data: PatientDetailViewData = {
			patient: { id: 'patient-one', full_name: 'Synthetic legacy amount' },
			entries: [
				{
					id: 'entry-one',
					created_at: '2026-01-15T12:30:00Z',
					entry_type: 'Consulta',
					description: 'Original consultation',
					amount: 125.5
				}
			],
			appointments: [],
			radiographs: [],
			role: 'owner',
			currentUserId: 'owner-one',
			businessTimeZone: 'UTC',
			clinicalTodayISO: '2026-10-18',
			documentUploads: 'not_permitted',
			followUpParticipates: false,
			followUpCanAssign: false,
			followUpTodayISO: '2026-10-18',
			permissions: {
				canReadClinicalHistory: true,
				canReadClinicalProfile: true,
				canEditClinicalProfile: true,
				canViewCosts: true,
				canEditPatient: true,
				canArchivePatient: true,
				canCreateClinicalEntry: true,
				canEditClinicalEntry: true,
				canCreateAppointment: true,
				canViewRadiographs: false,
				canUploadRadiographs: false,
				canViewRadiographTrash: false,
				canTrashRadiographs: false,
				canExportPatientData: false
			}
		};
		render(PatientPage, { data });
		await fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
		const dialog = screen.getByRole('dialog', { name: 'Editar entrada' });
		const description = dialog.querySelector<HTMLTextAreaElement>('[name="description"]');
		if (!description) throw new Error('Clinical description field missing');
		await fireEvent.input(description, { target: { value: 'Only the description changed' } });
		const form = dialog.querySelector('form');
		if (!form) throw new Error('Clinical editing form missing');
		expect(new FormData(form).get('amount')).toBe('125.5');
		expect(new FormData(form).get('amount_format')).toBe('canonical');
		const amount = dialog.querySelector<HTMLInputElement>('#edit_amount');
		if (!amount) throw new Error('Clinical amount field missing');
		expect(amount.value).toBe('125,5');
		await fireEvent.input(amount, { target: { value: '125,75' } });
		expect(new FormData(form).get('amount')).toBe('125.75');
		await fireEvent.input(amount, { target: { value: '1..2' } });
		expect(amount.validity.customError).toBe(true);
	});
});

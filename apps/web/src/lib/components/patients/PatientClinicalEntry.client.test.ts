/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';
import PatientPage from '../../../routes/odonto/pacientes/[id]/+page.svelte';
import type { PatientDetailViewData } from '$lib/patients/contracts';

type Submit = SubmitFunction<{ savedEntry?: unknown }, { message?: string }>;
const mocks = vi.hoisted(() => ({ submit: undefined as Submit | undefined }));
vi.mock('$app/forms', () => ({
	enhance: (_node: HTMLFormElement, submit: Submit) => {
		mocks.submit = submit;
		return { destroy() {} };
	}
}));
beforeEach(() => {
	mocks.submit = undefined;
});

vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({ url: new URL('https://app.test/odonto/pacientes/synthetic'), state: {} })
	};
});
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(), replaceState: vi.fn() }));
afterEach(cleanup);

function patientData(): PatientDetailViewData {
	return {
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
}
describe('actual patient clinical editor submission', () => {
	it('does not multiply an existing fractional clinical amount when editing only the description', async () => {
		render(PatientPage, { data: patientData() });
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
	it.each([true, false])(
		'merges only an owned confirmed entry without a full page reload (owned: %s)',
		async (owned) => {
			render(PatientPage, { data: patientData() });
			await fireEvent.click(screen.getByRole('button', { name: '+ Registrar consulta' }));
			const form = screen.getByRole('dialog').querySelector('form');
			if (!form || !mocks.submit) throw new Error('Clinical creation not enhanced');
			const input = {
				formElement: form,
				action: new URL('https://app.test/odonto/pacientes/patient-one?/add_entry'),
				formData: new FormData(form),
				controller: new AbortController(),
				submitter: null,
				cancel: vi.fn()
			};
			const finish = await mocks.submit(input);
			if (!finish) throw new Error('Clinical creation unexpectedly cancelled');
			const update = vi.fn().mockResolvedValue(undefined);
			await finish({
				...input,
				update,
				result: {
					type: 'success',
					status: 200,
					data: {
						savedEntry: {
							id: 'entry-two',
							patient_id: owned ? 'patient-one' : 'patient-two',
							created_at: '2026-01-15T12:45:00Z',
							entry_type: 'Control',
							description: 'New confirmed consultation',
							teeth: null,
							internal_note: null,
							amount: null,
							created_by_user_id: 'owner-one',
							locked_after: null
						}
					}
				}
			});
			if (owned) {
				expect(await screen.findByText('New confirmed consultation')).toBeInTheDocument();
				expect(update).toHaveBeenCalledExactlyOnceWith({ invalidateAll: false });
			} else {
				expect(screen.queryByText('New confirmed consultation')).not.toBeInTheDocument();
				expect(update).toHaveBeenCalledExactlyOnceWith(undefined);
			}
			expect(screen.getByText('Original consultation')).toBeInTheDocument();
		}
	);
});

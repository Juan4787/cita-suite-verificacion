/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
import type { PatientFormState, PatientPermissions } from '$lib/patients/contracts';
import PatientProfileDialog from './PatientProfileDialog.svelte';
type Submit = SubmitFunction<Record<string, never>, PatientFormState>;
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
afterEach(cleanup);
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
const revision = '2026-01-01T12:00:00Z';
const props = () => ({
	open: true,
	patient: {
		id: 'patient-one',
		full_name: 'Initial patient',
		updated_at: revision,
		clinical_profile_updated_at: revision,
		allergies: 'Synthetic private field'
	},
	permissions,
	scope: 'owner-one',
	onCommitted: vi.fn()
});
const formElement = () => {
	const form = screen.getByRole('dialog').querySelector('form');
	if (!form) throw new Error('Patient form missing');
	return form;
};
async function submit() {
	if (!mocks.submit) throw new Error('Patient form enhancement missing');
	const form = formElement();
	const input = {
		formElement: form,
		action: new URL('https://app.test/odonto/pacientes/patient-one?/update_patient'),
		formData: new FormData(form),
		controller: new AbortController(),
		submitter: null,
		cancel: vi.fn()
	};
	const complete = await mocks.submit(input);
	if (!complete) throw new Error('Patient form unexpectedly cancelled');
	return { input, complete, update: vi.fn().mockResolvedValue(undefined) };
}
async function finish(
	pending: Awaited<ReturnType<typeof submit>>,
	result: ActionResult<Record<string, never>, PatientFormState>
) {
	await pending.complete({ ...pending.input, result, update: pending.update });
}
describe('patient profile edit snapshot and response ownership', () => {
	it('does not acknowledge an unseen newer revision after a conflict or overwrite the open draft from refreshed data', async () => {
		const input = props(),
			view = render(PatientProfileDialog, input);
		await fireEvent.input(screen.getByLabelText('Nombre del paciente *'), {
			target: { value: 'Unsaved draft' }
		});
		await view.rerender({
			patient: {
				...input.patient,
				full_name: 'Other actor update',
				updated_at: '2026-01-02T12:00:00Z'
			},
			form: {
				message: 'La ficha cambió. Recargá para revisar.',
				currentPatientUpdatedAt: '2026-01-02T12:00:00Z'
			}
		});
		expect(screen.getByLabelText('Nombre del paciente *')).toHaveValue('Unsaved draft');
		expect(new FormData(formElement()).get('expected_patient_updated_at')).toBe(revision);
		expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
		expect(screen.getByRole('link', { name: 'Recargar ficha' })).toHaveAttribute(
			'data-sveltekit-reload'
		);
	});
	it('keeps fields and the original revision on technical failure, without showing raw errors', async () => {
		render(PatientProfileDialog, props());
		await fireEvent.input(screen.getByLabelText('Nombre del paciente *'), {
			target: { value: 'Unsaved draft' }
		});
		const pending = await submit();
		await finish(pending, { type: 'error', status: 500, error: { message: 'PRIVATE_SENTINEL' } });
		expect(await screen.findByRole('alert')).toHaveTextContent('tus datos siguen en el formulario');
		expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE_SENTINEL');
		expect(screen.getByLabelText('Nombre del paciente *')).toHaveValue('Unsaved draft');
		expect(new FormData(formElement()).get('expected_patient_updated_at')).toBe(revision);
		expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
	});
	it('does not apply a late update after a context change', async () => {
		const input = props(),
			view = render(PatientProfileDialog, input);
		const pending = await submit();
		await view.rerender({ patient: { ...input.patient, id: 'patient-two' }, scope: 'owner-two' });
		await finish(pending, {
			type: 'redirect',
			status: 303,
			location: '/odonto/pacientes/patient-one?tab=datos'
		});
		expect(input.onCommitted).not.toHaveBeenCalled();
		expect(pending.update).not.toHaveBeenCalled();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
	it('keeps clinical fields outside a basic receptionist edit', () => {
		render(PatientProfileDialog, {
			...props(),
			permissions: { ...permissions, canEditClinicalProfile: false }
		});
		expect(screen.queryByLabelText('Alergias (opcional)')).not.toBeInTheDocument();
		expect(screen.getByLabelText('Nombre del paciente *')).toBeInTheDocument();
	});
});

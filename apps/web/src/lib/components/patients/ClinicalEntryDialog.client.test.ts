/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import type { SubmitFunction, ActionResult } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClinicalEntryDialog from './ClinicalEntryDialog.svelte';

type Submit = SubmitFunction<{ savedEntry?: unknown }, { message?: string }>;
const mocks = vi.hoisted(() => ({ submit: undefined as Submit | undefined, enhances: 0 }));
vi.mock('$app/forms', () => ({
	enhance: (_node: HTMLFormElement, submit: Submit) => {
		mocks.submit = submit;
		mocks.enhances++;
		return { destroy() {} };
	}
}));
beforeEach(() => {
	mocks.submit = undefined;
	mocks.enhances = 0;
});
afterEach(cleanup);
const props = () => ({
	open: true,
	patient: { id: 'patient-one', full_name: 'Synthetic consultation' },
	scope: 'owner-one',
	canViewCosts: true,
	isProfessional: false,
	timeZone: 'UTC',
	onCreated: vi.fn(() => true),
	onCommitted: vi.fn()
});

async function submit() {
	const form = screen.getByRole('dialog').querySelector('form');
	if (!form || !mocks.submit) throw new Error('Clinical creation form not enhanced');
	const input = {
		formElement: form,
		action: new URL('https://app.test/odonto/pacientes/patient-one?/add_entry'),
		formData: new FormData(form),
		controller: new AbortController(),
		submitter: null,
		cancel: vi.fn()
	};
	const complete = await mocks.submit(input);
	if (!complete) throw new Error('Clinical creation unexpectedly cancelled');
	return { input, complete, update: vi.fn().mockResolvedValue(undefined) };
}
async function completeRequest(
	pending: Awaited<ReturnType<typeof submit>>,
	result: ActionResult<{ savedEntry?: unknown }, { message?: string }>
) {
	await pending.complete({ ...pending.input, result, update: pending.update });
}
describe('clinical task form ownership', () => {
	it('prevents a duplicate submit and merges one confirmed creation', async () => {
		const input = props();
		render(ClinicalEntryDialog, input);
		const pending = await submit();
		const duplicate = { ...pending.input, cancel: vi.fn() };
		await mocks.submit?.(duplicate);
		expect(duplicate.cancel).toHaveBeenCalledOnce();
		await completeRequest(pending, {
			type: 'success',
			status: 200,
			data: { savedEntry: { id: 'entry-one' } }
		});
		expect(input.onCreated).toHaveBeenCalledOnce();
		expect(pending.update).toHaveBeenCalledWith({ invalidateAll: false });
	});
	it('keeps an uncertain creation blocked across close/reopen and offers history recovery', async () => {
		const view = render(ClinicalEntryDialog, props());
		const pending = await submit();
		await completeRequest(pending, {
			type: 'error',
			status: 500,
			error: { message: 'PRIVATE_SENTINEL' }
		});
		expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE_SENTINEL');
		expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
		expect(screen.getByRole('link', { name: 'Revisar historial' })).toHaveAttribute(
			'href',
			'/odonto/pacientes/patient-one'
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
		await view.rerender({ open: true });
		expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
	});
	it('does not apply a late creation result after the patient or actor changes', async () => {
		const input = props();
		const view = render(ClinicalEntryDialog, input);
		const pending = await submit();
		await view.rerender({
			patient: { id: 'patient-two', full_name: 'Other patient' },
			scope: 'owner-two'
		});
		await completeRequest(pending, {
			type: 'success',
			status: 200,
			data: { savedEntry: { id: 'entry-one' } }
		});
		expect(input.onCreated).not.toHaveBeenCalled();
		expect(pending.update).not.toHaveBeenCalled();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
	it('keeps native editing and an existing custom clinical type', () => {
		render(ClinicalEntryDialog, {
			...props(),
			entry: {
				id: 'entry-one',
				created_at: '2026-01-15T12:30:00Z',
				entry_type: 'Historical custom type',
				description: 'Synthetic existing entry',
				amount: 125.5
			}
		});
		expect(mocks.enhances).toBe(0);
		expect(screen.getByRole('combobox', { name: 'Tipo de consulta' })).toHaveValue(
			'Historical custom type'
		);
		expect(screen.getByRole('dialog').querySelector('form')).toHaveAttribute(
			'action',
			'?/update_entry'
		);
	});
});

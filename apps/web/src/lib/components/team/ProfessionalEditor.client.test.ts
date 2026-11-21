/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';
import ProfessionalEditor from './ProfessionalEditor.svelte';
import { professionalEditorData } from '$lib/team/__fixtures__/editor';
const mocks = vi.hoisted(() => ({
	handlers: new Map<HTMLFormElement, SubmitFunction>(),
	invalidate: vi.fn()
}));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, handler: SubmitFunction) => {
		mocks.handlers.set(node, handler);
		return {
			destroy() {
				mocks.handlers.delete(node);
			}
		};
	}
}));
vi.mock('$app/navigation', () => ({
	beforeNavigate: vi.fn(),
	goto: vi.fn(),
	invalidate: mocks.invalidate
}));
beforeEach(() => {
	mocks.handlers.clear();
	mocks.invalidate.mockReset().mockResolvedValue(undefined);
	localStorage.clear();
});
afterEach(cleanup);
describe('professional editor cross-task coordination', () => {
	it('does not mark edits made during a submitted profile save as persisted', async () => {
		render(ProfessionalEditor, { data: professionalEditorData() });
		const field = screen.getByRole('textbox', { name: 'Nombre' });
		await fireEvent.input(field, { target: { value: 'Primera edición' } });
		const form = document.querySelector<HTMLFormElement>('form[action="?/update_profile"]');
		const handler = form && mocks.handlers.get(form);
		if (!form || !handler) throw new Error('Missing profile form');
		const input = {
			formElement: form,
			action: new URL('https://app.test/professional?/update_profile'),
			formData: new FormData(form),
			controller: new AbortController(),
			submitter: null,
			cancel: vi.fn()
		};
		const complete = await handler(input);
		if (!complete) throw new Error('Unexpected cancellation');
		await fireEvent.input(field, { target: { value: 'Segunda edición durante la espera' } });
		const duplicate = { ...input, cancel: vi.fn() };
		await handler(duplicate);
		expect(duplicate.cancel).toHaveBeenCalledOnce();
		await complete({
			...input,
			result: { type: 'success', status: 200, data: { success: true } },
			update: vi.fn().mockResolvedValue(undefined)
		});
		expect(field).toHaveValue('Segunda edición durante la espera');
		expect(screen.getByRole('button', { name: 'Guardar sólo perfil' })).toBeEnabled();
		expect(screen.getAllByText('Cambios sin guardar').length).toBeGreaterThan(0);
		// The tab marks its unsaved changes with a drawn icon, not a typed glyph.
		expect(screen.getByRole('img', { name: 'Cambios sin guardar' }).querySelector('svg')).not.toBeNull();
	});
	it('deselecting a service preserves a closed restricted schedule in the shared atomic payload', async () => {
		render(ProfessionalEditor, { data: professionalEditorData() });
		await fireEvent.click(screen.getByRole('button', { name: 'Servicios y aranceles' }));
		const checkbox = screen.getByRole('checkbox', { name: /Consulta sintética/ });
		await fireEvent.change(checkbox, { target: { checked: false } });
		expect(checkbox).not.toBeChecked();
		const payload = document.querySelector<HTMLInputElement>(
			'form[action="?/save_all"] input[name="schedule_blocks"]'
		);
		expect(payload).not.toBeNull();
		expect(JSON.parse(payload!.value)).toMatchObject([
			{ serviceScope: 'restricted', allowedServiceIds: [] }
		]);
		await fireEvent.click(screen.getByRole('button', { name: /^Horarios/ }));
		expect(
			screen.getByText('La franja está cerrada hasta que elijas una prestación.')
		).toBeVisible();
	});
});

describe('availability revision belongs to the persisted draft base', () => {
	it('does not replace a dirty draft token with the token of remotely changed rules', async () => {
		const initial = professionalEditorData();
		const view = render(ProfessionalEditor, { data: initial });
		await fireEvent.input(screen.getByRole('textbox', { name: /^Nombre(?:\s|$)/ }), {
			target: { value: 'Borrador local' }
		});
		await view.rerender({
			data: {
				...initial,
				availabilityRevision: 43,
				rules: initial.rules.map((rule) => ({ ...rule, start_time: '10:00:00' }))
			}
		});
		const form = document.querySelector<HTMLFormElement>('form[action="?/save_all"]');
		if (!form) throw new Error('Missing atomic form');
		expect(new FormData(form).getAll('availability_revision')).toEqual(['42']);
		expect(screen.getByRole('textbox', { name: /^Nombre(?:\s|$)/ })).toHaveValue('Borrador local');
	});
	it('can accept a fresh revision when the same persisted base is still displayed', async () => {
		const initial = professionalEditorData();
		const view = render(ProfessionalEditor, { data: initial });
		await fireEvent.input(screen.getByRole('textbox', { name: /^Nombre(?:\s|$)/ }), {
			target: { value: 'Borrador local' }
		});
		await view.rerender({ data: { ...initial, availabilityRevision: 43 } });
		const form = document.querySelector<HTMLFormElement>('form[action="?/save_all"]');
		if (!form) throw new Error('Missing atomic form');
		expect(new FormData(form).getAll('availability_revision')).toEqual(['43']);
		expect(screen.getByRole('textbox', { name: /^Nombre(?:\s|$)/ })).toHaveValue('Borrador local');
	});
});

describe('AF1-014: schedule block interval (Cada cuánto empieza un turno)', () => {
	it('displays and edits slot_interval_minutes, preserves existing value, and defaults new blocks to consultation duration', async () => {
		const initial = professionalEditorData();
		initial.services = [
			{
				...initial.services[0],
				duration_minutes: 60
			}
		];
		initial.rules = [
			{
				...initial.rules[0],
				slot_interval_minutes: 60,
				break_minutes: 0
			}
		];
		render(ProfessionalEditor, { data: initial });
		await fireEvent.click(screen.getByRole('button', { name: /^Horarios/ }));

		const stepInputs = screen.getAllByLabelText(/Cada cuánto empieza un turno/i);
		expect(stepInputs).toHaveLength(1);
		expect(stepInputs[0]).toHaveValue(60);

		// Adding a second block defaults to the consultation duration (60 min), not hardcoded 15.
		await fireEvent.click(screen.getByRole('button', { name: 'Agregar otro bloque' }));
		const updatedStepInputs = screen.getAllByLabelText(/Cada cuánto empieza un turno/i);
		expect(updatedStepInputs).toHaveLength(2);
		expect(updatedStepInputs[0]).toHaveValue(60);
		expect(updatedStepInputs[1]).toHaveValue(60);

		// Editing the second block interval updates the serialized payload.
		await fireEvent.input(updatedStepInputs[1], { target: { value: '30' } });
		const payload = document.querySelector<HTMLInputElement>(
			'form[action="?/save_weekly_rules"] input[name="schedule_blocks"]'
		);
		expect(JSON.parse(payload!.value)).toMatchObject([
			{ gridInterval: '60' },
			{ gridInterval: '30' }
		]);
	});
});

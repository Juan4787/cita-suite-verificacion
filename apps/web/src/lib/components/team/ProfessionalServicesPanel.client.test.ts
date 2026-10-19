/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction, ActionResult } from '@sveltejs/kit';
import ProfessionalServicesPanel from './ProfessionalServicesPanel.svelte';
import type { ProfessionalEditorService } from '$lib/team/professional-editor';
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
vi.mock('$app/navigation', () => ({ invalidate: mocks.invalidate }));
beforeEach(() => {
	mocks.handlers.clear();
	mocks.invalidate.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
const service = (): ProfessionalEditorService => ({
	id: 'service-one',
	name: 'Consulta sintética',
	description: null,
	duration_minutes: 30,
	buffer_before_minutes: 0,
	buffer_after_minutes: 0,
	price_label: '20000',
	updated_at: '2026-10-18T10:00:00Z',
	patient_instructions: null,
	public_reminder_description: null,
	is_active: true,
	is_public: true,
	sort_order: 0
});
const props = () => ({
	active: true,
	services: [service()],
	professional: { id: 'professional-one', name: 'Profesional sintético' },
	defaultServiceIds: [],
	canManage: true,
	selectedIds: ['service-one'],
	baselineIds: [],
	saving: null,
	dependencyKey: 'app:professional:professional-one',
	scope: 'business:actor:professional-one',
	onToggleService: vi.fn(),
	availabilityRevision: 42
});
async function submit(action: string) {
	const form = document.querySelector<HTMLFormElement>(`form[action="?/${action}"]`);
	const handler = form && mocks.handlers.get(form);
	if (!form || !handler) throw new Error('Service task is not enhanced');
	const input = {
		formElement: form,
		action: new URL(`https://app.test/professional?/${action}`),
		formData: new FormData(form),
		controller: new AbortController(),
		submitter: null,
		cancel: vi.fn()
	};
	const complete = await handler(input);
	if (!complete) throw new Error('Unexpected service task cancellation');
	return { input, complete, update: vi.fn().mockResolvedValue(undefined) };
}
async function finish(pending: Awaited<ReturnType<typeof submit>>, result: ActionResult) {
	await pending.complete({ ...pending.input, result, update: pending.update });
}
describe('professional service task state', () => {
	it('keeps the opening version and fields after fresh service props arrive', async () => {
		const view = render(ProfessionalServicesPanel, props());
		await fireEvent.click(screen.getByRole('button', { name: /Editar/ }));
		const dialog = screen.getByRole('dialog');
		const name = dialog.querySelector<HTMLInputElement>('[name="name"]');
		if (!name) throw new Error('Missing service name field');
		await fireEvent.input(name, { target: { value: 'Borrador sin guardar' } });
		await view.rerender({
			services: [{ ...service(), name: 'Cambio remoto', updated_at: '2026-10-18T11:00:00Z' }]
		});
		expect(name).toHaveValue('Borrador sin guardar');
		expect(dialog.querySelector('[name="service_updated_at"]')).toHaveValue('2026-10-18T10:00:00Z');
	});
	it('blocks an uncertain creation across close/reopen and offers a native review link', async () => {
		render(ProfessionalServicesPanel, props());
		await fireEvent.click(screen.getByRole('button', { name: 'Crear servicio nuevo' }));
		const pending = await submit('create_service');
		await finish(pending, { type: 'error', status: 500, error: { message: 'PRIVATE_SENTINEL' } });
		expect(screen.getByRole('link', { name: 'Revisar servicios' })).toHaveAttribute(
			'href',
			'/odonto/profesionales/professional-one?tab=servicios'
		);
		expect(document.body).not.toHaveTextContent('PRIVATE_SENTINEL');
		await fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Crear servicio nuevo' }));
		expect(screen.getByRole('button', { name: 'Crear y asignar' })).toBeDisabled();
	});
	it('ignores a creation result after the professional or actor scope changes', async () => {
		const view = render(ProfessionalServicesPanel, props());
		await fireEvent.click(screen.getByRole('button', { name: 'Crear servicio nuevo' }));
		const pending = await submit('create_service');
		await view.rerender({
			scope: 'business:other-actor:other-professional',
			professional: { id: 'professional-two', name: 'Otro profesional' }
		});
		await finish(pending, { type: 'success', status: 200, data: { serviceId: 'created-service' } });
		expect(pending.update).not.toHaveBeenCalled();
		expect(mocks.invalidate).not.toHaveBeenCalled();
	});
	it('sends the visible configuration revision when assigning services', async () => {
		render(ProfessionalServicesPanel, props());
		const pending = await submit('save_services');
		expect(pending.input.formData.get('availability_revision')).toBe('42');
		const handler = mocks.handlers.get(pending.input.formElement);
		const duplicate = { ...pending.input, cancel: vi.fn() };
		await handler?.(duplicate);
		expect(duplicate.cancel).toHaveBeenCalledOnce();
		await finish(pending, {
			type: 'failure',
			status: 409,
			data: { message: 'La configuración cambió.' }
		});
		expect(pending.update).toHaveBeenCalledWith({ reset: false });
	});
});

it('does not advertise service creation while client operations are unavailable', () => {
	render(ProfessionalServicesPanel, { ...props(), canManage: false });
	expect(screen.getByRole('button', { name: 'Crear servicio nuevo' })).toBeDisabled();
});

it('accepts exact integer durations and buffers supported by the server, without a five-minute step restriction', async () => {
	render(ProfessionalServicesPanel, props());
	await fireEvent.click(screen.getByRole('button', { name: 'Crear servicio nuevo' }));
	const createDuration = document.querySelector<HTMLInputElement>(
		'form[action="?/create_service"] [name="duration_minutes"]'
	);
	if (!createDuration) throw new Error('Missing duration');
	await fireEvent.input(createDuration, { target: { value: '23' } });
	expect(createDuration.checkValidity()).toBe(true);
	await fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
	await fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
	const buffer = document.querySelector<HTMLInputElement>(
		'[role="dialog"] [name="buffer_before_minutes"]'
	);
	if (!buffer) throw new Error('Missing buffer');
	await fireEvent.input(buffer, { target: { value: '3' } });
	expect(buffer.checkValidity()).toBe(true);
});

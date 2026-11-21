/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction, ActionResult } from '@sveltejs/kit';
import TeamMemberWizard from './TeamMemberWizard.svelte';
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
async function mount() {
	const onclose = vi.fn();
	const view = render(TeamMemberWizard, {
		services: [],
		roles: ['reception'],
		defaultServiceNames: ['Consulta', 'Otro servicio'],
		canManage: true,
		onclose
	});
	await fireEvent.input(screen.getByLabelText('Email'), {
		target: { value: 'synthetic@example.test' }
	});
	await fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
	await fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
	return { view, onclose };
}
async function submit() {
	const form = document.querySelector<HTMLFormElement>('form[action="?/add_user"]');
	const handler = form && mocks.handlers.get(form);
	if (!form || !handler) throw new Error('Missing wizard task');
	const input = {
		formElement: form,
		action: new URL('https://app.test/team?/add_user'),
		formData: new FormData(form),
		controller: new AbortController(),
		submitter: null,
		cancel: vi.fn()
	};
	const complete = await handler(input);
	if (!complete) throw new Error('Unexpected cancellation');
	return { input, complete, update: vi.fn().mockResolvedValue(undefined), handler };
}
async function finish(pending: Awaited<ReturnType<typeof submit>>, result: ActionResult) {
	await pending.complete({ ...pending.input, result, update: pending.update });
}
describe('team member wizard task boundary', () => {
	it('freezes the submitted task and cancels duplicate submissions', async () => {
		await mount();
		const pending = await submit();
		await fireEvent.focus(document.body);
		expect(screen.getByRole('button', { name: 'Atrás' })).toBeDisabled();
		const cancel = vi.fn();
		await pending.handler({ ...pending.input, cancel });
		expect(cancel).toHaveBeenCalledOnce();
		expect(pending.input.formData.get('email')).toBe('synthetic@example.test');
	});
	it('keeps uncertain outcomes in the task with a native review action, no raw error navigation', async () => {
		const { onclose } = await mount();
		const pending = await submit();
		await finish(pending, { type: 'error', status: 500, error: { message: 'PRIVATE_SENTINEL' } });
		expect(screen.getByRole('link', { name: 'Revisar equipo' })).toHaveAttribute(
			'href',
			'/odonto/configuracion/usuarios'
		);
		expect(screen.getByRole('button', { name: 'Guardar rol' })).toBeDisabled();
		expect(document.body).not.toHaveTextContent('PRIVATE_SENTINEL');
		expect(pending.update).not.toHaveBeenCalled();
		expect(onclose).not.toHaveBeenCalled();
	});
	it('ignores a result after the task has been unmounted by a context change', async () => {
		const { view, onclose } = await mount();
		const pending = await submit();
		view.unmount();
		await finish(pending, { type: 'success', status: 200, data: { success: true } });
		expect(onclose).not.toHaveBeenCalled();
		expect(pending.update).not.toHaveBeenCalled();
		expect(mocks.invalidate).not.toHaveBeenCalled();
	});

	it('AF1-012 & AF1-014: does not impose Consulta/Otro servicio when active services exist and exposes editable slot step defaulting to consultation duration', async () => {
		render(TeamMemberWizard, {
			services: [
				{ id: 'svc-1', name: 'Primera consulta', duration_minutes: 60, price_label: '$ 45.000', is_default: false },
				{ id: 'svc-2', name: 'Consulta de seguimiento', duration_minutes: 60, price_label: '$ 35.000', is_default: false }
			],
			roles: ['professional'],
			defaultServiceNames: ['Consulta', 'Otro servicio'],
			canManage: true,
			onclose: vi.fn()
		});
		await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'nueva@example.test' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
		await fireEvent.click(screen.getByRole('button', { name: /Profesional/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
		await fireEvent.input(screen.getByPlaceholderText('Nombre y apellido'), { target: { value: 'Dra. Nueva' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

		// Step servicios: existing clinic services are shown, generic defaults are NOT imposed.
		expect(screen.getByText('Primera consulta')).toBeVisible();
		expect(screen.queryByText('Otro servicio')).not.toBeInTheDocument();
		await fireEvent.click(screen.getByRole('checkbox', { name: /Primera consulta/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

		// Step horarios: visible editable "Cada cuánto empieza un turno" defaulting to 60 min (consultation duration).
		const stepInput = screen.getByLabelText(/Cada cuánto empieza un turno/i);
		expect(stepInput).toHaveValue(60);
	});
});

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProfessionalLifecyclePanel from './ProfessionalLifecyclePanel.svelte';
import { professionalEditorData } from '$lib/team/__fixtures__/editor';
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
describe('professional dependency inspection task', () => {
	it('rejects malformed success, retains the confirmation boundary and recovers through retry', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(Response.json({}))
			.mockResolvedValueOnce(
				Response.json({ appointment_count: 0, clinical_entry_count: 0, follow_up_count: 0 })
			);
		vi.stubGlobal('fetch', fetch);
		render(ProfessionalLifecyclePanel, {
			data: professionalEditorData(),
			canManage: true,
			professionalDependencyKey: 'app:professional:professional-one'
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
		expect(
			await screen.findByText('No pudimos comprobar el historial. Volvé a intentar.')
		).toBeVisible();
		expect(
			screen.queryByRole('button', { name: 'Eliminar profesional' })
		).not.toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
		expect(
			await screen.findByRole('button', { name: 'Eliminar profesional' })
		).toBeVisible();
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it('aborts the owned dependency request when the task is destroyed', async () => {
		let signal: AbortSignal | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn((_url, init) => {
				signal = init?.signal;
				return new Promise(() => {});
			})
		);
		const view = render(ProfessionalLifecyclePanel, {
			data: professionalEditorData(),
			canManage: true,
			professionalDependencyKey: 'app:professional:professional-one'
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
		expect(signal?.aborted).toBe(false);
		view.unmount();
		expect(signal?.aborted).toBe(true);
	});
});

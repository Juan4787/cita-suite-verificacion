/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PatientHistoryPanel from './PatientHistoryPanel.svelte';
import type { PatientHistoryEntry } from '$lib/patients/contracts';

const row = (id: string, day: string, description: string): PatientHistoryEntry => ({
	id,
	created_at: `2026-01-${day}T12:00:00Z`,
	description,
	entry_type: 'Consulta',
	amount: null
});
const first = row('a6400000-0000-4000-8000-000000000004', '03', 'Initial consultation');
const older = row('a6400000-0000-4000-8000-000000000005', '02', 'Older consultation');
const props = (entries = [first]) => ({
	active: true,
	patientId: 'patient-one',
	scope: 'owner-one',
	historyRevision: entries,
	entries,
	hasMoreEntries: true,
	businessTimeZone: 'UTC',
	canEditClinicalEntry: true,
	currentUserId: 'owner-one',
	isProfessional: false,
	onEdit: vi.fn()
});
const page = (items: PatientHistoryEntry[]) =>
	Response.json({ items, has_more: false, next_cursor_created_at: null, next_cursor_id: null });

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('patient history interaction and request ownership', () => {
	it('shows a cost with its cents and keeps the precision of a historical fraction', () => {
		const entries = [
			{ ...first, amount: 125.5 },
			{ ...row('a6400000-0000-4000-8000-000000000006', '01', 'Whole amount'), amount: 1250 },
			{ ...row('a6400000-0000-4000-8000-000000000007', '04', 'Historical fraction'), amount: 0.001 }
		];
		render(PatientHistoryPanel, { props: { ...props(entries), hasMoreEntries: false } });

		expect(screen.getByText('$ 125,50')).toBeInTheDocument();
		expect(screen.getByText('$ 1.250')).toBeInTheDocument();
		expect(screen.getByText('$ 0,001')).toBeInTheDocument();
	});
	it('opens the complete description with Space and keeps editing separate from expansion', async () => {
		const user = userEvent.setup();
		const input = props([
			{
				...first,
				title: 'Summary',
				description: 'Complete synthetic description\nSecond line preserved'
			}
		]);
		render(PatientHistoryPanel, input);
		const toggle = screen.getByRole('button', { name: /^Detalles de Consulta/ });
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		toggle.focus();
		await user.keyboard(' ');
		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		const detail = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
		expect(detail).toBeVisible();
		expect(detail).toHaveTextContent('Complete synthetic description Second line preserved');
		expect(detail).toHaveClass('whitespace-pre-wrap');
		await user.click(screen.getByRole('button', { name: 'Editar' }));
		expect(input.onEdit).toHaveBeenCalledExactlyOnceWith(input.entries[0]);
		expect(toggle).toHaveAttribute('aria-expanded', 'true');
	});
	it('shows a filtered empty state and restores history when clearing filters', async () => {
		render(PatientHistoryPanel, props());
		await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'No matches' } });
		expect(screen.getByRole('status')).toHaveTextContent('No hay consultas que coincidan');
		expect(screen.queryByText(/Sin consultas registradas/)).not.toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
		expect(screen.getByText(first.description)).toBeInTheDocument();
		expect(screen.getByRole('searchbox')).toHaveValue('');
	});
	it('keeps existing history on an invalid success and allows a verified retry', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ items: [] }))
			.mockResolvedValueOnce(page([older]));
		vi.stubGlobal('fetch', fetcher);
		render(PatientHistoryPanel, props());
		await fireEvent.click(screen.getByRole('button', { name: 'Cargar más historial' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar más historial');
		expect(screen.getByText(first.description)).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Cargar más historial' }));
		expect(await screen.findByText(older.description)).toBeInTheDocument();
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Cargar más historial' })).not.toBeInTheDocument();
		const url = new URL(fetcher.mock.calls[0][0], 'https://app.test');
		expect(url.searchParams.get('cursor_id')).toBe(first.id);
	});
	it('discards a late response for a different patient and does not clear a newer loading state', async () => {
		let finishOld!: (value: Response) => void, finishNew!: (value: Response) => void;
		const oldRequest = new Promise<Response>((resolve) => {
			finishOld = resolve;
		});
		const newRequest = new Promise<Response>((resolve) => {
			finishNew = resolve;
		});
		const fetcher = vi.fn().mockReturnValueOnce(oldRequest).mockReturnValueOnce(newRequest);
		vi.stubGlobal('fetch', fetcher);
		const view = render(PatientHistoryPanel, props());
		await fireEvent.click(screen.getByRole('button', { name: 'Cargar más historial' }));
		const newFirst = row(
			'a6400000-0000-4000-8000-000000000006',
			'04',
			'Other patient consultation'
		);
		await view.rerender({ ...props([newFirst]), patientId: 'patient-two', scope: 'owner-two' });
		expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Cargar más historial' }));
		finishOld(page([older]));
		await waitFor(() => expect(screen.getByRole('button', { name: 'Cargando...' })).toBeDisabled());
		expect(screen.queryByText(older.description)).not.toBeInTheDocument();
		finishNew(page([]));
		await waitFor(() =>
			expect(screen.queryByRole('button', { name: 'Cargando...' })).not.toBeInTheDocument()
		);
		expect(screen.getByText(newFirst.description)).toBeInTheDocument();
	});
	it('retains filters across tabs and exposes entry editing only to its authorized author', async () => {
		const entry = { ...first, created_by_user_id: 'another-professional' };
		const input = { ...props([entry]), isProfessional: true };
		const view = render(PatientHistoryPanel, input);
		expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
		await fireEvent.input(screen.getByRole('searchbox', { name: 'Buscar en el historial' }), {
			target: { value: 'initial' }
		});
		await view.rerender({ active: false });
		expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
		await view.rerender({ active: true });
		expect(screen.getByRole('searchbox')).toHaveValue('initial');
	});
	it('aborts an in-flight page when the history is unmounted', async () => {
		const fetcher = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
		vi.stubGlobal('fetch', fetcher);
		const view = render(PatientHistoryPanel, props());
		await fireEvent.click(screen.getByRole('button', { name: 'Cargar más historial' }));
		view.unmount();
		expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
	});
});

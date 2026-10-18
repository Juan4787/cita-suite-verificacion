/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ManualPatientPicker from './ManualPatientPicker.svelte';
import type { ManualBookingPatient } from '$lib/patients/manual-booking';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
const patient = (id: string, name: string): ManualBookingPatient => ({
	id,
	full_name: name,
	phone: null,
	phone_raw: null,
	phone_e164: null,
	dni: id === 'one' ? '11111111' : '22222222',
	birth_date: null,
	activity_at: '2026-01-01T12:00:00Z',
	blocked: false
});
const props = () => ({
	patients: [patient('one', 'Recent patient')],
	loaded: true,
	loading: false,
	error: '',
	selectedId: '',
	query: '',
	onSelect: vi.fn(),
	onNeedPatients: vi.fn()
});
function deferred() {
	let complete: (response: Response) => void = () => {
		throw new Error('Deferred not initialized');
	};
	const promise = new Promise<Response>((resolve) => {
		complete = resolve;
	});
	return { promise, complete };
}
describe('manual patient search task', () => {
	it('shows a recoverable error for incomplete success and does not report no matches', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ patients: [{}] }))
			.mockResolvedValueOnce(Response.json({ patients: [patient('two', 'Recovered patient')] }));
		vi.stubGlobal('fetch', fetcher);
		render(ManualPatientPicker, props());
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'query' } });
		expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos buscar pacientes');
		expect(
			screen.queryByText('No encontramos pacientes con esa búsqueda.')
		).not.toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Reintentar búsqueda' }));
		expect(await screen.findByRole('button', { name: /Recovered patient/ })).toBeInTheDocument();
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});
	it('aborts and discards a previous result when the query is cleared', async () => {
		const pending = deferred(),
			fetcher = vi.fn().mockReturnValue(pending.promise);
		vi.stubGlobal('fetch', fetcher);
		render(ManualPatientPicker, props());
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'old query' } });
		await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: '' } });
		expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
		pending.complete(Response.json({ patients: [patient('two', 'Late old patient')] }));
		await Promise.resolve();
		expect(screen.getByRole('button', { name: /Recent patient/ })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Late old patient/ })).not.toBeInTheDocument();
	});
	it('does not overwrite a newer query with an older response even if fetch ignores cancellation', async () => {
		const older = deferred(),
			newer = deferred();
		const fetcher = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
		vi.stubGlobal('fetch', fetcher);
		render(ManualPatientPicker, props());
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'older' } });
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'newer' } });
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		newer.complete(Response.json({ patients: [patient('two', 'Newer patient')] }));
		expect(await screen.findByRole('button', { name: /Newer patient/ })).toBeInTheDocument();
		older.complete(Response.json({ patients: [patient('one', 'Older patient')] }));
		await Promise.resolve();
		expect(screen.getByRole('button', { name: /Newer patient/ })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Older patient/ })).not.toBeInTheDocument();
	});
	it('selects homonymous patients by identity and preserves disambiguation', async () => {
		const input = {
			...props(),
			patients: [patient('one', 'Same name'), patient('two', 'Same name')]
		};
		render(ManualPatientPicker, input);
		const choices = screen.getAllByRole('button', { name: /Same name/ });
		expect(choices[0]).toHaveTextContent('11111111');
		expect(choices[1]).toHaveTextContent('22222222');
		await fireEvent.click(choices[1]);
		expect(input.onSelect).toHaveBeenCalledExactlyOnceWith(input.patients[1]);
	});
	it('aborts a pending request when leaving the task', async () => {
		const pending = deferred(),
			fetcher = vi.fn().mockReturnValue(pending.promise);
		vi.stubGlobal('fetch', fetcher);
		const view = render(ManualPatientPicker, props());
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'query' } });
		await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
		view.unmount();
		expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
		pending.complete(Response.json({ patients: [patient('two', 'Late patient')] }));
		await Promise.resolve();
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});
});

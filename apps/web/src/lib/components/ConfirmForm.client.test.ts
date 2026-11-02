/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfirmForm from './ConfirmForm.svelte';

afterEach(cleanup);

const setup = (body: () => string = () => 'Cita Suite deja de poder entrar a tu cuenta en este momento.') => {
	const submitted: Record<string, FormDataEntryValue>[] = [];
	const view = render(ConfirmForm, {
		action: '/odonto/configuracion/ayuda?/end',
		fields: { grant_id: 'grant-1', return_to: '/odonto/agenda' },
		label: 'Terminar ayuda',
		title: 'Terminar la ayuda',
		body,
		confirmLabel: 'Sí, terminar ayuda'
	});
	const form = view.container.querySelector('form');
	if (!form) throw new Error('ConfirmForm renders no form.');
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		submitted.push(Object.fromEntries(new FormData(form)));
	});
	return { form, submitted };
};

describe('an action that asks for confirmation first', () => {
	it('asks before doing anything and sends the confirmation only from the dialog', async () => {
		const { submitted } = setup();

		await fireEvent.click(screen.getByRole('button', { name: 'Terminar ayuda' }));

		const dialog = screen.getByRole('dialog', { name: 'Terminar la ayuda' });
		expect(within(dialog).getByText('Cita Suite deja de poder entrar a tu cuenta en este momento.')).toBeInTheDocument();
		expect(submitted).toHaveLength(0);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Sí, terminar ayuda' }));

		expect(submitted).toEqual([{ grant_id: 'grant-1', return_to: '/odonto/agenda', confirmed: '1' }]);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('does nothing when the person cancels or presses Escape', async () => {
		const { submitted } = setup();

		await fireEvent.click(screen.getByRole('button', { name: 'Terminar ayuda' }));
		await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Terminar ayuda' }));
		await fireEvent.keyDown(screen.getByRole('dialog').parentElement as HTMLElement, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

		expect(submitted).toHaveLength(0);
	});

	it('cannot submit the form without the dialog', () => {
		const { form } = setup();

		const trigger = screen.getByRole('button', { name: 'Terminar ayuda' });
		expect(trigger).toHaveAttribute('type', 'button');
		expect(form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])')).toHaveLength(0);
	});

	it('writes the text when the dialog opens, so a time in it is current', async () => {
		const body = vi.fn().mockReturnValueOnce('Primera apertura.').mockReturnValueOnce('Segunda apertura.');
		setup(body);

		await fireEvent.click(screen.getByRole('button', { name: 'Terminar ayuda' }));
		expect(screen.getByText('Primera apertura.')).toBeInTheDocument();
		await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Terminar ayuda' }));
		expect(screen.getByText('Segunda apertura.')).toBeInTheDocument();
		expect(body).toHaveBeenCalledTimes(2);
	});

	it('sends a confirmed action once and keeps the trigger disabled while it goes', async () => {
		const { submitted } = setup();

		await fireEvent.click(screen.getByRole('button', { name: 'Terminar ayuda' }));
		const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, terminar ayuda' });
		await fireEvent.click(confirm);
		await fireEvent.click(confirm);

		expect(submitted).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Terminar ayuda' })).toBeDisabled();
	});
});

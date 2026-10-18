/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import DateTimePartsInput from './DateTimePartsInput.svelte';
afterEach(cleanup);
describe('clinical wall-clock date fields', () => {
	it('shows the practice calendar day and hour instead of the browser UTC date', () => {
		const { container } = render(DateTimePartsInput, {
			initialValue: '2026-01-01T01:30:00Z',
			timeZone: 'America/Argentina/Buenos_Aires',
			readOnly: true
		});
		expect(screen.getByLabelText('Año')).toHaveValue('2025');
		expect(screen.getByLabelText('Mes')).toHaveValue('12');
		expect(screen.getByLabelText('Día')).toHaveValue('31');
		expect(screen.getByLabelText('Hora')).toHaveValue('22:30');
		expect(screen.getByLabelText('Hora')).toHaveAttribute('readonly');
		expect(container.querySelector<HTMLInputElement>('[name="created_at"]')?.value).toBe(
			'2025-12-31T22:30'
		);
	});
	it('keeps midnight as 00 and submits an edited local clock without silently converting the date twice', async () => {
		const { container } = render(DateTimePartsInput, {
			initialValue: '2026-01-01T00:00:00Z',
			timeZone: 'UTC'
		});
		expect(screen.getByLabelText('Hora')).toHaveValue('00:00');
		await fireEvent.input(screen.getByLabelText('Hora'), { target: { value: '09:45' } });
		expect(container.querySelector<HTMLInputElement>('[name="created_at"]')?.value).toBe(
			'2026-01-01T09:45'
		);
	});
});

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ManualAppointmentWizard from './ManualAppointmentWizard.svelte';

const date = '2099-08-25';
const startsAt = '2099-08-25T13:00:00.000Z';

type WizardPatient = {
	id: string;
	full_name: string;
	phone: string;
	phone_raw: string;
	phone_e164: string | null;
	dni: string | null;
	birth_date: string | null;
	activity_at: string;
	blocked: boolean;
};

const renderWizard = (
	phone: string,
	options: { patients?: WizardPatient[]; initialPatientId?: string } = {}
) => {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					slots: [
						{
							date,
							time: '10:00',
							starts_at: startsAt,
							professional_id: 'professional-1',
							professional_ids: ['professional-1']
						}
					]
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		)
	);

	const initialPatientId = options.initialPatientId ?? 'patient-1';
	return render(ManualAppointmentWizard, {
		services: [{ id: 'service-1', name: 'Consulta', duration_minutes: 30 }],
		professionals: [
			{ id: 'professional-1', name: 'Dra. Prueba', specialty: null, is_active: true }
		],
		serviceProfessionalIds: { 'service-1': ['professional-1'] },
		patients: options.patients ?? [
			{
				id: 'patient-1',
				full_name: 'Paciente de prueba',
				phone,
				phone_raw: phone,
				phone_e164: phone || null,
				dni: '12345678',
				birth_date: '1990-01-02',
				activity_at: '2099-01-01T00:00:00.000Z',
				blocked: false
			}
		],
		patientsLoaded: true,
		initialDate: date,
		initialPatientId,
		appointmentRequestId: 'a1000000-0000-4000-8000-000000000001',
		canOperate: true,
		form: {
			values: {
				service_id: 'service-1',
				professional_id: 'professional-1',
				date,
				time: '10:00',
				patient_id: initialPatientId,
				patient_phone: phone
			}
		}
	});
};

beforeEach(() => {
	vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(function (
		this: HTMLFormElement
	) {
		this.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('validación previa del teléfono al crear un turno', () => {
	it('no presenta el campo como problemático mientras se completa normalmente', async () => {
		const user = userEvent.setup();
		renderWizard('');
		const phone = screen.getByLabelText('Teléfono');

		await user.type(phone, '351 123 4567');

		expect(phone.className).not.toContain('border-amber-300');
		expect(phone).not.toHaveAttribute('aria-invalid', 'true');
	});

	it('detiene un número inválido y lleva el foco al mismo formulario para corregirlo', async () => {
		const user = userEvent.setup();
		const { container } = renderWizard('123');
		const form = container.querySelector('form');
		expect(form).not.toBeNull();

		expect(await fireEvent.submit(form!)).toBe(false);
		expect(screen.getByText('El número de teléfono no es válido')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Confirmar turno' })).toBeDisabled();

		await user.click(screen.getByRole('button', { name: 'Corregir número' }));
		const phone = screen.getByLabelText('Teléfono');
		await waitFor(() => expect(phone).toHaveFocus());
		expect(screen.queryByText('El número de teléfono no es válido')).not.toBeInTheDocument();
		expect(phone.className).toContain('border-amber-300');

		await user.clear(phone);
		await user.type(phone, '351 123 4567');
		expect(await fireEvent.submit(form!)).toBe(true);
		expect(screen.queryByText('El número de teléfono no es válido')).not.toBeInTheDocument();
		expect((container.querySelector('[name="patient_id"]') as HTMLInputElement).value).toBe(
			'patient-1'
		);
		expect((container.querySelector('[name="patient_mode"]') as HTMLInputElement).value).toBe(
			'existing'
		);
	});

	it('permite confirmar sin teléfono sólo después de una decisión explícita', async () => {
		const user = userEvent.setup();
		const { container } = renderWizard('');
		const form = container.querySelector('form');
		expect(form).not.toBeNull();

		expect(await fireEvent.submit(form!)).toBe(false);
		expect(screen.getByText('Falta el número de teléfono')).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Confirmar de todos modos' }));
		await waitFor(() =>
			expect(
				(container.querySelector('[name="phone_warning_override"]') as HTMLInputElement).value
			).toBe('missing')
		);
		expect(HTMLFormElement.prototype.requestSubmit).toHaveBeenCalledTimes(1);
		expect(screen.queryByText('Falta el número de teléfono')).not.toBeInTheDocument();
	});

	it('muestra y permite seleccionar por ID dos fichas con el mismo nombre y teléfono', async () => {
		const user = userEvent.setup();
		const sharedPhone = '342 504 8209';
		const patients: WizardPatient[] = [
			{
				id: 'patient-1',
				full_name: 'Persona compartida',
				phone: sharedPhone,
				phone_raw: sharedPhone,
				phone_e164: '+5493425048209',
				dni: '11111111',
				birth_date: '1980-01-01',
				activity_at: '2099-01-01T00:00:00.000Z',
				blocked: false
			},
			{
				id: 'patient-2',
				full_name: 'Persona compartida',
				phone: sharedPhone,
				phone_raw: sharedPhone,
				phone_e164: '+5493425048209',
				dni: '22222222',
				birth_date: '1990-02-02',
				activity_at: '2099-02-02T00:00:00.000Z',
				blocked: false
			}
		];
		const { container } = renderWizard(sharedPhone, { patients });

		expect(screen.getByText(/DNI 11111111/)).toBeInTheDocument();
		expect(screen.getByText(/DNI 22222222/)).toBeInTheDocument();
		const choices = screen.getAllByRole('button', {
			name: /Persona compartida/
		});
		expect(choices).toHaveLength(2);
		await user.click(choices[1]);

		expect((container.querySelector('[name="patient_id"]') as HTMLInputElement).value).toBe(
			'patient-2'
		);
		expect((container.querySelector('[name="patient_mode"]') as HTMLInputElement).value).toBe(
			'existing'
		);
	});
});

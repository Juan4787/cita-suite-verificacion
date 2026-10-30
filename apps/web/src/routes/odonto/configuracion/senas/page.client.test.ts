/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const policy = (overrides: Record<string, unknown> = {}) => ({
	revision: 2,
	enabled: true,
	autoCancelEnabled: true,
	amountMode: 'fixed',
	fixedAmount: 40000,
	percentage: null,
	requestDays: 7,
	deadlineHours: 48,
	minPaymentHours: 24,
	transferDetails: 'Alias natalia.frutos',
	appliesToManual: true,
	excludedServiceIds: [],
	...overrides
});

const data = (overrides: Record<string, unknown> = {}) =>
	({
		demo: false,
		context: {},
		policy: policy(),
		services: [
			{ id: 'service-all', name: 'Consulta', fee: 'all' },
			{ id: 'service-some', name: 'Control', fee: 'some' },
			{ id: 'service-none', name: 'Taller', fee: 'none' }
		],
		whatsappConfigured: true,
		automationStopped: false,
		...overrides
	}) as never;

afterEach(() => cleanup());

const formOf = () => document.querySelector('form') as HTMLFormElement;

describe('configuración de señas', () => {
	it('envía la política guardada con su revisión y las casillas marcadas', () => {
		render(Page, { data: data() });
		const fields = new FormData(formOf());
		expect(Object.fromEntries(fields)).toMatchObject({
			expected_revision: '2',
			enabled: 'true',
			amount_mode: 'fixed',
			fixed_amount: '40000',
			request_days: '7',
			deadline_hours: '48',
			min_payment_hours: '24',
			auto_cancel_enabled: 'true',
			transfer_details: 'Alias natalia.frutos',
			applies_to_manual: 'true'
		});
		expect(screen.getByText(/Cada reserva nueva va a pedir \$\s40\.000\./)).toBeInTheDocument();
	});

	it('advierte que sin el WhatsApp del consultorio la persona no ve los botones', () => {
		render(Page, { data: data({ whatsappConfigured: false }) });
		expect(screen.getByRole('link', { name: 'Configurar el WhatsApp' })).toHaveAttribute('href', '/odonto/configuracion/whatsapp');
	});

	it('advierte que la cancelación automática está detenida por el operador', () => {
		render(Page, { data: data({ automationStopped: true }) });
		expect(screen.getByText(/detenida por el operador de Cita Suite/)).toBeInTheDocument();
	});

	it('informa que no se pudo comprobar la habilitación del operador, sin asumir que está encendida', () => {
		render(Page, { data: data({ automationStopped: null }) });
		expect(screen.getByRole('alert')).toHaveTextContent('No pudimos comprobar si las señas están habilitadas');
	});

	it('con porcentaje y sin monto fijo dice qué prestaciones no van a pedir seña', async () => {
		render(Page, { data: data({ policy: policy({ amountMode: 'percentage', percentage: 35, fixedAmount: null }) }) });
		const notice = document.querySelector('[data-without-fee]') as HTMLElement;
		expect(notice).toHaveTextContent('ahí no se va a pedir seña');
		expect(notice).toHaveTextContent('Control (tiene arancel sólo para algunos profesionales)');
		expect(notice).toHaveTextContent('Taller');
		expect(notice).not.toHaveTextContent('Consulta');
		// Excluding a service takes it off the warning.
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Taller' }));
		expect(document.querySelector('[data-without-fee]')).not.toHaveTextContent('Taller');
	});

	it('con porcentaje y monto fijo de respaldo dice que ahí se pide el monto fijo', () => {
		render(Page, { data: data({ policy: policy({ amountMode: 'percentage', percentage: 35, fixedAmount: 30000 }) }) });
		expect(document.querySelector('[data-without-fee]')).toHaveTextContent('ahí se pide el monto fijo');
	});

	it('cambiar de forma de cálculo no pierde el porcentaje escrito', async () => {
		render(Page, { data: data({ policy: policy({ amountMode: 'percentage', percentage: 35.5 }) }) });
		// The help text is inside the same label, so it is part of the field's accessible name.
		expect(screen.getByRole('textbox', { name: /^Porcentaje del arancel/ })).toHaveValue('35,5');
		await fireEvent.click(screen.getByRole('radio', { name: /monto fijo/ }));
		expect(new FormData(formOf()).get('percentage')).toBe('35,5');
	});

	it('al apagar una seña activa avisa que las pendientes quedan exceptuadas', async () => {
		render(Page, { data: data() });
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Pedir seña en las reservas' }));
		expect(screen.getByText(/las señas pendientes quedan exceptuadas/)).toBeInTheDocument();
	});

	it('si el guardado fue rechazado muestra lo escrito y el error de cada campo', () => {
		render(Page, {
			data: data(),
			form: {
				message: 'Revisá los datos marcados. No se guardó nada.',
				errors: { fixed_amount: 'Escribí el monto en pesos, sin centavos. Por ejemplo, 40.000.' },
				values: {
					enabled: true,
					autoCancelEnabled: false,
					amountMode: 'fixed',
					fixedAmount: '40000,50',
					percentage: '',
					requestDays: '7',
					deadlineHours: '48',
					minPaymentHours: '24',
					transferDetails: 'Alias nuevo',
					appliesToManual: false,
					excludedServiceIds: []
				}
			}
		});
		expect(screen.getByRole('status')).toHaveTextContent('Revisá los datos marcados. No se guardó nada.');
		expect(screen.getByText('Escribí el monto en pesos, sin centavos. Por ejemplo, 40.000.')).toBeInTheDocument();
		const fields = new FormData(formOf());
		expect(fields.get('fixed_amount')).toBe('40000,50');
		expect(fields.get('transfer_details')).toBe('Alias nuevo');
		expect(fields.get('auto_cancel_enabled')).toBeNull();
		expect(fields.get('applies_to_manual')).toBeNull();
	});
});

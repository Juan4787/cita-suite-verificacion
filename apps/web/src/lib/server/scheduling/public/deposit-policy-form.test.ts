import { describe, expect, it } from 'vitest';
import { parsePolicyForm } from '$lib/server/scheduling/public/deposit-policy-form';

const SERVICE = '00000000-0000-4000-8000-0000000000d1';
const OTHER = '00000000-0000-4000-8000-0000000000d2';
const services = new Set([SERVICE, OTHER]);

const formWith = (fields: Record<string, string | string[]>) => {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		for (const item of Array.isArray(value) ? value : [value]) form.append(name, item);
	}
	return form;
};
const complete = (overrides: Record<string, string | string[]> = {}) =>
	formWith({
		enabled: 'true',
		auto_cancel_enabled: 'true',
		amount_mode: 'fixed',
		fixed_amount: '40.000',
		percentage: '',
		request_days: '7',
		deadline_hours: '48',
		min_payment_hours: '24',
		transfer_details: '  Alias natalia.frutos  ',
		applies_to_manual: 'true',
		...overrides
	});

describe('formulario de la configuración de señas', () => {
	it('lee la política de Natalia tal como se escribe', () => {
		expect(parsePolicyForm(complete(), services)).toMatchObject({
			errors: {},
			policy: {
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
				excludedServiceIds: []
			}
		});
	});

	it('una casilla sin marcar es «no», nunca un valor por defecto', () => {
		const form = complete();
		form.delete('enabled');
		form.delete('auto_cancel_enabled');
		form.delete('applies_to_manual');
		expect(parsePolicyForm(form, services).policy).toMatchObject({ enabled: false, autoCancelEnabled: false, appliesToManual: false });
	});

	it('acepta el porcentaje con coma o punto y hasta dos decimales', () => {
		expect(parsePolicyForm(complete({ amount_mode: 'percentage', percentage: '35,5' }), services).policy.percentage).toBe(35.5);
		expect(parsePolicyForm(complete({ amount_mode: 'percentage', percentage: '35.25' }), services).policy.percentage).toBe(35.25);
		expect(parsePolicyForm(complete({ amount_mode: 'percentage', percentage: '33,333' }), services).errors.percentage).toBeDefined();
		expect(parsePolicyForm(complete({ amount_mode: 'percentage', percentage: '0' }), services).errors.percentage).toBeDefined();
		expect(parsePolicyForm(complete({ amount_mode: 'percentage', percentage: '101' }), services).errors.percentage).toBeDefined();
	});

	it('el monto es en pesos enteros: centavos, letras o puntos mal puestos son un error, nunca un redondeo', () => {
		for (const amount of ['40000,50', '40.000,5', '4.00.00', '40 mil', '-40000', '0']) {
			expect(parsePolicyForm(complete({ fixed_amount: amount }), services).errors.fixed_amount).toBeDefined();
		}
		expect(parsePolicyForm(complete({ fixed_amount: '40000' }), services).policy.fixedAmount).toBe(40000);
	});

	it('con la seña activa exige el monto de la forma elegida', () => {
		expect(parsePolicyForm(complete({ fixed_amount: '' }), services).errors.fixed_amount).toBe('Con la seña activa, falta el monto.');
		expect(parsePolicyForm(complete({ amount_mode: 'percentage', percentage: '' }), services).errors.percentage).toBe(
			'Con la seña activa, falta el porcentaje.'
		);
		const off = complete({ fixed_amount: '' });
		off.delete('enabled');
		expect(parsePolicyForm(off, services).errors).toEqual({});
	});

	it('fuera de rango, los plazos y los datos de transferencia se marcan uno por uno', () => {
		const { errors } = parsePolicyForm(
			complete({ request_days: '0', deadline_hours: '721', min_payment_hours: '7,5', transfer_details: 'x'.repeat(501) }),
			services
		);
		expect(Object.keys(errors).sort()).toEqual(['deadline_hours', 'min_payment_hours', 'request_days', 'transfer_details']);
	});

	it('sólo excluye prestaciones de este consultorio, una vez cada una', () => {
		const { policy } = parsePolicyForm(complete({ excluded_service_ids: [SERVICE, SERVICE, 'no-es-uuid', '00000000-0000-4000-8000-0000000000ff'] }), services);
		expect(policy.excludedServiceIds).toEqual([SERVICE]);
	});

	it('conserva lo escrito para mostrarlo otra vez si el guardado falla', () => {
		expect(parsePolicyForm(complete({ fixed_amount: '40000,50', request_days: 'siete' }), services).values).toMatchObject({
			fixedAmount: '40000,50',
			requestDays: 'siete',
			transferDetails: 'Alias natalia.frutos'
		});
	});
});

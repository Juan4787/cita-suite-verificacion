/** @vitest-environment jsdom */

// Página de suscripción (docs/plans/cobros-mercadopago-20261118.md, sección 8): el plan pagado aparte no ofrece
// Mercado Pago, el acceso provisorio no se anuncia como pago y el precio propio se muestra con su aviso.
import { cleanup, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const BUTTON = 'Activar suscripción con Mercado Pago';

const access = (overrides: Record<string, unknown> = {}, subscription: Record<string, unknown> = {}) => ({
	canEnterApp: true,
	canUseBusiness: true,
	commercialStatus: 'active',
	visualStatus: 'active',
	isPermanent: false,
	commercialAccessEnabled: true,
	paidUntil: '2027-11-02T00:33:49.000Z',
	graceUntil: '2027-11-04T00:33:49.000Z',
	restrictedUntil: '2027-12-04T00:33:49.000Z',
	archivedAt: null,
	daysUntilExpiration: 349,
	hoursUntilExpiration: 8376,
	shouldShowExpiringWarning: false,
	allowedCapabilities: [],
	subscription: {
		business_id: 'business-1',
		access_source: 'manual',
		last_payment_amount: null,
		last_payment_at: null,
		updated_at: null,
		access_note: null,
		...subscription
	},
	...overrides
});

const data = (overrides: Record<string, unknown> = {}, accessState = access()) =>
	({
		context: { business: { id: 'business-1', name: 'Consultorio de prueba' }, role: 'owner', access: accessState },
		grants: [],
		demo: false,
		mpSubscription: null,
		mpSubscriptionUnavailable: false,
		mpAmount: 90000,
		mpPriceLocked: false,
		mpEnvironment: 'production',
		mpReturn: null,
		mpReturnFailed: false,
		...overrides
	}) as never;

const authorizedSubscription = {
	preapproval_id: 'pre-1',
	status: 'authorized',
	payer_email: 'duena@example.test',
	transaction_amount: 90000,
	next_charge_at: '2026-12-18T12:00:00.000Z',
	updated_at: '2026-11-18T12:00:00.000Z',
	last_charge_status: null,
	last_charge_detail: null,
	last_charge_at: null
};

afterEach(() => cleanup());

describe('plan pagado aparte (decisión de Juan del 18-nov-2026)', () => {
	it('mientras está vigente no ofrece Mercado Pago y dice hasta cuándo está pago', () => {
		render(Page, { params: {}, form: null, data: data() });
		expect(screen.queryByRole('button', { name: BUTTON })).not.toBeInTheDocument();
		expect(screen.queryByText('Suscripción con Mercado Pago')).not.toBeInTheDocument();
		expect(screen.getByText(/Tu plan está pago hasta el/)).toBeInTheDocument();
		expect(screen.getByText('Tu plan está pago: no necesitás suscribirte ahora.')).toBeInTheDocument();
	});

	it('una suscripción de Mercado Pago que ya existe se sigue mostrando, para gestionarla', () => {
		render(Page, { params: {}, form: null, data: data({ mpSubscription: authorizedSubscription }) });
		expect(screen.getByText('Suscripción con Mercado Pago')).toBeInTheDocument();
		expect(screen.queryByText(/Tu plan está pago hasta el/)).not.toBeInTheDocument();
	});

	it('vencido el plan, vuelve a ofrecer Mercado Pago', () => {
		render(Page, { params: {}, form: null, data: data({}, access({ commercialStatus: 'grace', visualStatus: 'grace' })) });
		expect(screen.getByRole('button', { name: BUTTON })).toBeInTheDocument();
	});

	it('con acceso de Mercado Pago, sin suscripción activa, sigue ofreciendo suscribirse', () => {
		render(Page, { params: {}, form: null, data: data({}, access({}, { access_source: 'mercado_pago' })) });
		expect(screen.getByRole('button', { name: BUTTON })).toBeInTheDocument();
	});
});

describe('acceso provisorio y precio propio (20261118020000)', () => {
	it('con el acceso provisorio en curso lo dice y no anuncia un pago', () => {
		render(Page, {
			params: {},
			form: null,
			data: data(
				{
					mpSubscription: authorizedSubscription,
					mpReturn: { subscriptionStatus: 'authorized', creditedNow: false, accessBlocked: false, provisionalUntil: '2026-11-19T19:00:00.000Z' },
					grants: [
						{
							id: 'grant-1',
							operation: 'provisional_access',
							source: 'mercado_pago',
							note: 'Acceso provisorio mientras Mercado Pago procesa el primer cobro.',
							amount: null,
							created_at: '2026-11-18T19:00:00.000Z',
							paid_until_before: null,
							paid_until_after: '2026-11-19T19:00:00.000Z'
						}
					]
				},
				access({ paidUntil: '2026-11-19T19:00:00.000Z', graceUntil: '2026-11-19T19:00:00.000Z' }, { access_source: 'mercado_pago' })
			)
		});
		expect(screen.getByText(/Tenés acceso provisorio hasta el/)).toBeInTheDocument();
		expect(screen.getAllByText('Acceso provisorio').length).toBeGreaterThan(0);
		expect(screen.queryByText(/Pago acreditado/)).not.toBeInTheDocument();
	});

	it('el precio propio se muestra con el aviso de que se conserva', () => {
		render(Page, {
			params: {},
			form: null,
			data: data(
				{ mpAmount: 10, mpPriceLocked: true },
				access({ canUseBusiness: false, commercialStatus: 'restricted', visualStatus: 'restricted', paidUntil: null, graceUntil: null }, { access_source: 'internal' })
			)
		});
		expect(screen.getByText(/\$\s10/)).toBeInTheDocument();
		expect(screen.getByText(/Es el precio de tu suscripción/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: BUTTON })).toBeInTheDocument();
	});
});

describe('correo del pagador (18-nov-2026)', () => {
	it('el campo empieza vacío: no propone el correo de ingreso', () => {
		render(Page, { params: {}, form: null, data: data({}, access({}, { access_source: 'mercado_pago' })) });
		expect(screen.getByLabelText('Correo de tu cuenta de Mercado Pago')).toHaveValue('');
		expect(screen.getByText(/puede ser distinto del que usás en\s+Cita Suite/)).toBeInTheDocument();
	});

	it('con una solicitud pendiente dice para qué correo quedó y que se confirma entrando con esa cuenta', () => {
		render(Page, {
			params: {},
			form: null,
			data: data({ mpSubscription: { ...authorizedSubscription, status: 'pending', payer_email: 'otra@example.test' } }, access({}, { access_source: 'mercado_pago' }))
		});
		expect(screen.getByText(/para «otra@example.test»/)).toBeInTheDocument();
		expect(screen.getByText(/sólo se puede confirmar entrando con esa cuenta/)).toBeInTheDocument();
	});

	it('después de un error conserva lo que se escribió', () => {
		render(Page, { params: {}, form: { message: 'Mercado Pago no aceptó la solicitud.', payerEmail: 'escrita@example.test' } as never, data: data({}, access({}, { access_source: 'mercado_pago' })) });
		expect(screen.getByLabelText('Correo de tu cuenta de Mercado Pago')).toHaveValue('escrita@example.test');
	});
});

import { describe, expect, it } from 'vitest';
import { getBusinessAccessState } from './commercial-access';

const now = new Date('2026-05-28T12:00:00.000Z');
const isoFromNow = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

const baseSubscription = {
	business_id: 'business-1',
	commercial_access_enabled: true,
	is_permanent: false,
	subscription_status: 'active',
	access_starts_at: '2026-05-01T00:00:00.000Z',
	paid_until: null,
	grace_until: null,
	restricted_until: null,
	archived_at: null,
	expiration_notice_enabled: false
};

describe('getBusinessAccessState', () => {
	it('mantiene compatibilidad activa sólo para negocios legacy sin fila de suscripción', () => {
		const state = getBusinessAccessState(null, {
			now,
			businessCreatedAt: '2026-05-20T12:00:00.000Z'
		});

		expect(state.commercialStatus).toBe('active');
		expect(state.isPermanent).toBe(true);
		expect(state.canUseBusiness).toBe(true);
		expect(state.allowedCapabilities.canCreateAppointment).toBe(true);
	});

	it('bloquea negocios nuevos sin suscripción explícita', () => {
		const state = getBusinessAccessState(null, {
			now,
			businessCreatedAt: '2026-05-28T06:00:00.000Z'
		});

		expect(state.commercialStatus).toBe('restricted');
		expect(state.isPermanent).toBe(false);
		expect(state.canUseBusiness).toBe(false);
		expect(state.allowedCapabilities.canCreateAppointment).toBe(false);
	});

	it('permite fallback explícito cuando la migración todavía no está disponible', () => {
		const state = getBusinessAccessState(null, { now, legacyFallback: true });

		expect(state.commercialStatus).toBe('active');
		expect(state.isPermanent).toBe(true);
		expect(state.canUseBusiness).toBe(true);
	});

	it('trata una suscripción permanente como activa y sin vencimiento', () => {
		const state = getBusinessAccessState(
			{
				...baseSubscription,
				is_permanent: true,
				paid_until: null
			},
			{ now }
		);

		expect(state.visualStatus).toBe('permanent');
		expect(state.paidUntil).toBeNull();
		expect(state.allowedCapabilities.canManageUsers).toBe(true);
	});

	it('muestra aviso preventivo sólo cuando corresponde', () => {
		const state = getBusinessAccessState(
			{
				...baseSubscription,
				paid_until: isoFromNow(20),
				expiration_notice_enabled: true
			},
			{ now }
		);

		expect(state.commercialStatus).toBe('active');
		expect(state.visualStatus).toBe('expiring');
		expect(state.shouldShowExpiringWarning).toBe(true);
	});

	it('usa grace con operación completa hasta el límite de 48 horas', () => {
		const state = getBusinessAccessState(
			{
				...baseSubscription,
				paid_until: isoFromNow(-2),
				grace_until: isoFromNow(20),
				restricted_until: isoFromNow(24 * 31)
			},
			{ now }
		);

		expect(state.commercialStatus).toBe('grace');
		expect(state.canUseBusiness).toBe(true);
		expect(state.allowedCapabilities.canCreatePatient).toBe(true);
	});

	it('bloquea acciones operativas en restricted pero mantiene la lectura permitida', () => {
		const state = getBusinessAccessState(
			{
				...baseSubscription,
				paid_until: isoFromNow(-72),
				grace_until: isoFromNow(-24),
				restricted_until: isoFromNow(24 * 10)
			},
			{ now }
		);

		expect(state.commercialStatus).toBe('restricted');
		expect(state.canUseBusiness).toBe(false);
		expect(state.allowedCapabilities.canViewExistingPatients).toBe(true);
		expect(state.allowedCapabilities.canCreatePatient).toBe(false);
		expect(state.allowedCapabilities.canUsePublicBooking).toBe(false);
	});

	it('deja sólo el estado de suscripción en archived', () => {
		const state = getBusinessAccessState(
			{
				...baseSubscription,
				commercial_access_enabled: false,
				paid_until: isoFromNow(-24 * 40),
				grace_until: isoFromNow(-24 * 38),
				restricted_until: isoFromNow(-24),
				archived_at: isoFromNow(-1)
			},
			{ now }
		);

		expect(state.commercialStatus).toBe('archived');
		expect(state.canEnterApp).toBe(false);
		expect(state.allowedCapabilities.canViewExistingPatients).toBe(false);
	});

	it('bloquea manualmente el uso comercial sin tocar emails existentes', () => {
		const state = getBusinessAccessState(
			{
				...baseSubscription,
				commercial_access_enabled: false,
				is_permanent: true,
				paid_until: null
			},
			{ now }
		);

		expect(state.commercialStatus).toBe('restricted');
		expect(state.visualStatus).toBe('restricted');
		expect(state.commercialAccessEnabled).toBe(false);
		expect(state.canEnterApp).toBe(false);
		expect(state.allowedCapabilities.canCreateAppointment).toBe(false);
	});
});

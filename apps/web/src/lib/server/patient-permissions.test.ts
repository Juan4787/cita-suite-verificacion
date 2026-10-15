import { describe, expect, it } from 'vitest';
import type { BusinessContext } from './business';
import { canExportPatientData, resolvePatientPermissions } from './patient-permissions';

const context = (overrides: Partial<BusinessContext> = {}): BusinessContext =>
	({
		business: {
			id: 'business-1',
			name: 'Consultorio',
			slug: 'consultorio',
			industry: 'odontology',
			phone: null,
			email: null,
			address: null,
			address_instructions: null,
			maps_url: null,
			logo_url: null,
			timezone: 'America/Argentina/Buenos_Aires',
			public_booking_enabled: true,
			whatsapp_enabled: false,
			allow_same_day_booking: false,
			min_booking_notice_minutes: 0,
			max_booking_days_ahead: 60,
			cancellation_policy: null,
			is_active: true
		},
		role: 'owner',
		canManage: true,
		canOperate: true,
		access: {
			canEnterApp: true,
			canUseBusiness: true,
			commercialStatus: 'active',
			visualStatus: 'active',
			isPermanent: false,
			commercialAccessEnabled: true,
			paidUntil: null,
			graceUntil: null,
			restrictedUntil: null,
			archivedAt: null,
			daysUntilExpiration: null,
			hoursUntilExpiration: null,
			shouldShowExpiringWarning: false,
			allowedCapabilities: {
				canViewExistingPatients: true,
				canViewExistingClinicalNotes: true,
				canViewExistingCosts: true,
				canCreatePatient: true,
				canEditPatient: true,
				canCreateAppointment: true,
				canEditAppointment: true,
				canCancelAppointment: true,
				canRescheduleAppointment: true,
				canUsePublicBooking: true,
				canManageServices: true,
				canManageProfessionals: true,
				canManageAvailability: true,
				canCreateClinicalEntry: true,
				canEditClinicalEntry: true,
				canManagePatientFiles: true,
				canManageUsers: true,
				canViewSubscription: true
			},
			subscription: null
		},
		assistance: null,
		...overrides
	}) as BusinessContext;

describe('patient export permissions', () => {
	it('allows a direct owner or admin, including restricted read access', () => {
		expect(canExportPatientData(context())).toBe(true);
		expect(canExportPatientData(context({ role: 'admin' }))).toBe(true);
		expect(
			canExportPatientData(
				context({
					access: {
						...context().access,
						canUseBusiness: false,
						canEnterApp: true,
						commercialStatus: 'restricted',
						visualStatus: 'restricted'
					}
				})
			)
		).toBe(true);
	});

	it('denies temporary assistance even though its effective role is admin', () => {
		const assistance = context({
			role: 'admin',
			assistance: {
				grantId: 'grant-1',
				requestedByUserId: 'owner-1',
				supportUserId: 'support-1',
				startsAt: '2026-08-27T12:00:00.000Z',
				expiresAt: '2026-08-27T13:00:00.000Z'
			}
		});
		expect(canExportPatientData(assistance)).toBe(false);
		expect(resolvePatientPermissions(assistance).canExportPatientData).toBe(false);
	});

	it('denies professionals, reception, archived and manually paused access', () => {
		expect(canExportPatientData(context({ role: 'professional' }))).toBe(false);
		expect(canExportPatientData(context({ role: 'reception' }))).toBe(false);
		expect(
			canExportPatientData(context({ access: { ...context().access, canEnterApp: false } }))
		).toBe(false);
	});
});

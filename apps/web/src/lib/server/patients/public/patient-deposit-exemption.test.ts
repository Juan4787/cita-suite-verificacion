import { describe, expect, it, vi } from 'vitest';
import type { BusinessContext } from '$lib/server/access/public/business';
import { resolvePatientPermissions } from './patient-permissions';
import {
	PatientDepositExemptionError,
	setPatientDepositAutoCancelExemption
} from './patient-deposit-exemption';

const BUSINESS = '00000000-0000-4000-8000-0000000000b1';
const PATIENT = '00000000-0000-4000-8000-0000000000p1'.replace('p', 'a');

const makeContext = (role: BusinessContext['role'], canUseBusiness = true): BusinessContext =>
	({
		business: { id: BUSINESS, timezone: 'America/Argentina/Buenos_Aires', industry: 'odontology' },
		role,
		canManage: role === 'owner' || role === 'admin',
		canOperate: role === 'owner' || role === 'admin' || role === 'reception',
		access: {
			canEnterApp: true,
			canUseBusiness,
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
			}
		},
		assistance: null
	}) as unknown as BusinessContext;

describe('P3: permisos de la marca «No cancelar sus turnos por seña impaga» con los cinco roles', () => {
	it.each(['owner', 'admin', 'reception'] as const)(
		'permite activar o quitar la marca al rol %s con consultorio operativo',
		(role) => {
			expect(resolvePatientPermissions(makeContext(role, true)).canManageDepositAutoCancelExemption).toBe(true);
		}
	);

	it.each(['professional', 'readonly'] as const)(
		'impide modificar la marca al rol %s',
		(role) => {
			expect(resolvePatientPermissions(makeContext(role, true)).canManageDepositAutoCancelExemption).toBe(false);
		}
	);

	it.each(['owner', 'admin', 'reception', 'professional', 'readonly'] as const)(
		'bloquea al rol %s cuando el consultorio no tiene acceso operativo vigente',
		(role) => {
			expect(resolvePatientPermissions(makeContext(role, false)).canManageDepositAutoCancelExemption).toBe(false);
		}
	);
});

describe('P3: comando autenticado setPatientDepositAutoCancelExemption', () => {
	it('valida identificadores antes de llamar a la base y llama a la RPC autenticada', async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: { exempt: true, updated_at: '2026-11-28T10:00:00.000Z', updated_by_name: 'Ana Recepción', updated_deposits: 2 },
			error: null
		});
		await expect(
			setPatientDepositAutoCancelExemption({ rpc } as never, {
				businessId: 'mal',
				patientId: PATIENT,
				exempt: true
			})
		).rejects.toMatchObject({ code: 'PATIENT_NOT_FOUND' });
		expect(rpc).not.toHaveBeenCalled();

		const saved = await setPatientDepositAutoCancelExemption({ rpc } as never, {
			businessId: BUSINESS,
			patientId: PATIENT,
			exempt: true
		});
		expect(rpc).toHaveBeenCalledExactlyOnceWith('set_patient_deposit_auto_cancel_exemption', {
			p_business_id: BUSINESS,
			p_patient_id: PATIENT,
			p_exempt: true
		});
		expect(saved).toEqual({
			exempt: true,
			updatedAt: '2026-11-28T10:00:00.000Z',
			updatedByName: 'Ana Recepción',
			updatedDeposits: 2
		});
	});

	it('traduce los errores explícitos de permisos y paciente inexistente', async () => {
		for (const [raw, expectedCode, expectedStatus] of [
			['PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN', 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN', 403],
			['PATIENT_NOT_FOUND', 'PATIENT_NOT_FOUND', 404],
			['unexpected timeout', 'PATIENT_DEPOSIT_EXEMPTION_UNEXPECTED', 500]
		] as const) {
			const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: raw } });
			try {
				await setPatientDepositAutoCancelExemption({ rpc } as never, {
					businessId: BUSINESS,
					patientId: PATIENT,
					exempt: true
				});
				expect.unreachable('should throw');
			} catch (err) {
				expect(err).toBeInstanceOf(PatientDepositExemptionError);
				expect((err as PatientDepositExemptionError).code).toBe(expectedCode);
				expect((err as PatientDepositExemptionError).status).toBe(expectedStatus);
			}
		}
	});
});

import type { BusinessContext } from '$lib/server/access/public/business';
import { canExportPatientDataFromContext } from '$lib/utils/patient-export-permissions';
import type { PatientPermissions } from '$lib/patients/contracts';

export const canExportPatientData = (context: BusinessContext) =>
	canExportPatientDataFromContext(context);

export const resolvePatientPermissions = (context: BusinessContext): PatientPermissions => {
	const role = context.role;
	const capabilities = context.access.allowedCapabilities;
	const isOwnerOrAdmin = role === 'owner' || role === 'admin';
	const canEditPatientData =
		role === 'owner' || role === 'admin' || role === 'reception' || role === 'professional';
	const canWriteClinical = role === 'owner' || role === 'admin' || role === 'professional';
	const radiographRoleEligible = role === 'owner' || role === 'admin' || role === 'professional';
	const canReadClinicalDataNow = isOwnerOrAdmin
		? context.access.canEnterApp
		: context.access.canUseBusiness;
	const canArchivePatient = role === 'owner' || role === 'admin' || role === 'professional';

	return {
		canReadClinicalHistory:
			role !== 'reception' && capabilities.canViewExistingClinicalNotes &&
			canReadClinicalDataNow,
		canReadClinicalProfile:
			(role === 'owner' || role === 'admin' || role === 'professional') &&
			capabilities.canViewExistingClinicalNotes && canReadClinicalDataNow,
		canEditClinicalProfile:
			(role === 'owner' || role === 'admin' || role === 'professional') && capabilities.canEditPatient,
		canViewCosts: isOwnerOrAdmin && capabilities.canViewExistingCosts && canReadClinicalDataNow,
		canEditPatient: canEditPatientData && capabilities.canEditPatient,
		canArchivePatient: canArchivePatient && capabilities.canEditPatient,
		canCreateClinicalEntry: canWriteClinical && capabilities.canCreateClinicalEntry,
		canEditClinicalEntry: canWriteClinical && capabilities.canEditClinicalEntry,
		canCreateAppointment:
			(role === 'owner' || role === 'admin' || role === 'reception') &&
			capabilities.canCreateAppointment,
		canViewRadiographs:
			radiographRoleEligible &&
			capabilities.canViewExistingClinicalNotes &&
			canReadClinicalDataNow,
		canUploadRadiographs:
			radiographRoleEligible && capabilities.canManagePatientFiles && context.access.canUseBusiness,
		canViewRadiographTrash:
			isOwnerOrAdmin && capabilities.canViewExistingClinicalNotes && context.access.canEnterApp,
		canTrashRadiographs:
			isOwnerOrAdmin && capabilities.canManagePatientFiles && context.access.canUseBusiness,
		canExportPatientData: canExportPatientData(context)
	};
};

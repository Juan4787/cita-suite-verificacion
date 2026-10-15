import type { BusinessContext } from './business';
import { canExportPatientDataFromContext } from '$lib/utils/patient-export-permissions';

export const canExportPatientData = (context: BusinessContext) =>
	canExportPatientDataFromContext(context);

export const resolvePatientPermissions = (context: BusinessContext) => {
	const role = context.role;
	const capabilities = context.access.allowedCapabilities;
	const isOwnerOrAdmin = role === 'owner' || role === 'admin';
	const canEditPatientData =
		role === 'owner' || role === 'admin' || role === 'reception' || role === 'professional';
	const canWriteClinical = role === 'owner' || role === 'admin' || role === 'professional';
	const radiographRoleEligible = role === 'owner' || role === 'admin' || role === 'professional';
	const canAccessRadiographsNow = isOwnerOrAdmin
		? context.access.canEnterApp
		: context.access.canUseBusiness;
	const canArchivePatient = role === 'owner' || role === 'admin' || role === 'professional';

	return {
		canReadClinicalProfile:
			(role === 'owner' || role === 'admin' || role === 'professional') &&
			capabilities.canViewExistingClinicalNotes,
		canEditClinicalProfile:
			(role === 'owner' || role === 'admin' || role === 'professional') && capabilities.canEditPatient,
		canViewCosts: isOwnerOrAdmin && capabilities.canViewExistingCosts,
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
			canAccessRadiographsNow,
		canUploadRadiographs:
			radiographRoleEligible && capabilities.canManagePatientFiles && context.access.canUseBusiness,
		canViewRadiographTrash:
			isOwnerOrAdmin && capabilities.canViewExistingClinicalNotes && context.access.canEnterApp,
		canTrashRadiographs:
			isOwnerOrAdmin && capabilities.canManagePatientFiles && context.access.canUseBusiness,
		canExportPatientData: canExportPatientData(context)
	};
};

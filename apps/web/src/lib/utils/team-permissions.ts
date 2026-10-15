export type AttendingActorRole = 'owner' | 'admin' | 'reception' | 'professional' | 'readonly';
export type AttendingTargetRole = AttendingActorRole;

export const roleSupportsProfessionalProfile = (role: AttendingTargetRole) =>
	role === 'owner' || role === 'admin' || role === 'professional';

export const shouldConfigureProfessionalProfile = ({
	role,
	requested
}: {
	role: AttendingTargetRole;
	requested: boolean;
}) => role === 'professional' || (requested && roleSupportsProfessionalProfile(role));

export const canAssignTeamRole = ({
	actorRole,
	targetRole,
	isAssisting
}: {
	actorRole: AttendingActorRole;
	targetRole: AttendingTargetRole;
	isAssisting: boolean;
}) => {
	if (actorRole === 'owner') return true;
	if (actorRole !== 'admin') return false;
	if (targetRole === 'owner') return false;
	if (targetRole === 'admin') return isAssisting;
	return true;
};

export const canConfigureAttendingProfile = ({
	actorRole,
	targetRole,
	isAssisting
}: {
	actorRole: AttendingActorRole;
	targetRole: AttendingTargetRole;
	isAssisting: boolean;
}) => {
	if (targetRole !== 'owner' && targetRole !== 'admin') return false;
	if (actorRole === 'owner') return true;
	if (actorRole !== 'admin') return false;
	return targetRole === 'admin' || isAssisting;
};

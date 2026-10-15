import { describe, expect, it } from 'vitest';
import {
	canAssignTeamRole,
	canConfigureAttendingProfile,
	roleSupportsProfessionalProfile,
	shouldConfigureProfessionalProfile
} from './team-permissions';

describe('professional-profile role model', () => {
	it('requires a profile for professionals and keeps it optional for owners and admins', () => {
		expect(shouldConfigureProfessionalProfile({ role: 'professional', requested: false })).toBe(true);
		expect(shouldConfigureProfessionalProfile({ role: 'admin', requested: false })).toBe(false);
		expect(shouldConfigureProfessionalProfile({ role: 'admin', requested: true })).toBe(true);
		expect(shouldConfigureProfessionalProfile({ role: 'owner', requested: true })).toBe(true);
	});

	it('does not attach a professional profile to reception or readonly access', () => {
		expect(roleSupportsProfessionalProfile('reception')).toBe(false);
		expect(roleSupportsProfessionalProfile('readonly')).toBe(false);
		expect(shouldConfigureProfessionalProfile({ role: 'reception', requested: true })).toBe(false);
	});
});

describe('team-role assignment authority', () => {
	it('lets the owner assign every team role', () => {
		expect(canAssignTeamRole({ actorRole: 'owner', targetRole: 'owner', isAssisting: false })).toBe(true);
		expect(canAssignTeamRole({ actorRole: 'owner', targetRole: 'admin', isAssisting: false })).toBe(true);
	});

	it('keeps a regular admin from adding owners or other administrators', () => {
		expect(canAssignTeamRole({ actorRole: 'admin', targetRole: 'owner', isAssisting: false })).toBe(false);
		expect(canAssignTeamRole({ actorRole: 'admin', targetRole: 'admin', isAssisting: false })).toBe(false);
		expect(canAssignTeamRole({ actorRole: 'admin', targetRole: 'reception', isAssisting: false })).toBe(true);
	});

	it('lets the master add an administrator only during active assistance', () => {
		expect(canAssignTeamRole({ actorRole: 'admin', targetRole: 'admin', isAssisting: true })).toBe(true);
		expect(canAssignTeamRole({ actorRole: 'admin', targetRole: 'owner', isAssisting: true })).toBe(false);
	});
});

describe('attending-profile authority', () => {
	it('lets an owner configure both owner and admin profiles', () => {
		expect(canConfigureAttendingProfile({ actorRole: 'owner', targetRole: 'owner', isAssisting: false })).toBe(true);
		expect(canConfigureAttendingProfile({ actorRole: 'owner', targetRole: 'admin', isAssisting: false })).toBe(true);
	});

	it('keeps a regular admin from configuring the owner', () => {
		expect(canConfigureAttendingProfile({ actorRole: 'admin', targetRole: 'owner', isAssisting: false })).toBe(false);
		expect(canConfigureAttendingProfile({ actorRole: 'admin', targetRole: 'admin', isAssisting: false })).toBe(true);
	});

	it('lets the master configure owner and admin only during active assistance', () => {
		expect(canConfigureAttendingProfile({ actorRole: 'admin', targetRole: 'owner', isAssisting: true })).toBe(true);
		expect(canConfigureAttendingProfile({ actorRole: 'admin', targetRole: 'admin', isAssisting: true })).toBe(true);
		expect(canConfigureAttendingProfile({ actorRole: 'admin', targetRole: 'reception', isAssisting: true })).toBe(false);
	});
});

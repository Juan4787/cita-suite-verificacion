import { describe, expect, it } from 'vitest';
import { parseBusinessRoleAccesses, parseRoleAccessOutcome } from './team-contracts';
const member = () => ({
	id: 'membership-one',
	business_id: 'business-one',
	user_id: 'user-one',
	email: 'synthetic@example.test',
	role: 'owner',
	status: 'active',
	professional_id: null,
	created_at: '2026-10-18T10:00:00Z'
});
describe('team access boundary', () => {
	it('keeps genuine empty and complete scopes valid', () => {
		expect(parseBusinessRoleAccesses([], 'business-one')).toEqual([]);
		expect(parseBusinessRoleAccesses([member()], 'business-one')).toEqual([member()]);
	});
	it('rejects the whole list for malformed, duplicate or foreign membership instead of losing it silently', () => {
		for (const rows of [
			[member(), { ...member(), id: 'other', role: 'unknown' }],
			[member(), member()],
			[{ ...member(), business_id: 'business-two' }],
			[{ ...member(), id: { unexpected: true } }],
			[{ ...member(), created_at: 'invalid' }],
			[{ ...member(), user_id: null }],
			[{ ...member(), professional_id: undefined, user_id: undefined }],
			[
				{
					id: 'missing',
					business_id: 'business-one',
					email: 'synthetic@example.test',
					role: 'owner',
					status: 'pending',
					created_at: '2026-10-18T10:00:00Z'
				}
			]
		])
			expect(() => parseBusinessRoleAccesses(rows, 'business-one')).toThrow();
	});
	it('requires the persisted identity of the actual access outcome', () => {
		expect(
			parseRoleAccessOutcome([
				{ status: 'active', membership_id: 'member-one', user_id: 'user-one', invite_id: null }
			])
		).toBe('active');
		expect(
			parseRoleAccessOutcome([
				{ status: 'pending', membership_id: null, user_id: null, invite_id: 'invite-one' }
			])
		).toBe('pending');
		for (const rows of [
			[],
			[{}],
			[{ status: 'active' }],
			[{ status: 'pending', invite_id: null }],
			[{ status: 'unknown' }]
		])
			expect(() => parseRoleAccessOutcome(rows)).toThrow();
	});
});

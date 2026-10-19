import { BUSINESS_ROLES, type BusinessRole } from './contracts';
import {
	InvalidDataContractError,
	readArray,
	readChoice,
	readNullableText,
	readRecord,
	readText
} from '$lib/contracts/json';
export type BusinessRoleAccess = {
	id: string;
	business_id: string;
	user_id: string | null;
	email: string;
	role: BusinessRole;
	status: 'active' | 'pending';
	professional_id: string | null;
	created_at: string;
};
export const ROLE_ACCESS_OUTCOMES = [
	'active',
	'pending',
	'already_active',
	'already_pending'
] as const;
export type RoleAccessOutcome = (typeof ROLE_ACCESS_OUTCOMES)[number];
export function parseBusinessRoleAccesses(
	value: unknown,
	businessId: string
): BusinessRoleAccess[] {
	const seen = new Set<string>();
	return readArray(value, 'team.access.list').map((item) => {
		const row = readRecord(item, 'team.access.row');
		const id = readText(row.id, 'team.access.id'),
			scope = readText(row.business_id, 'team.access.business');
		const email = readText(row.email, 'team.access.email'),
			created = readText(row.created_at, 'team.access.created');
		if (
			!id ||
			seen.has(id) ||
			scope !== businessId ||
			!email ||
			!Number.isFinite(Date.parse(created))
		)
			throw new InvalidDataContractError('team.access.scope');
		const status = readChoice(row.status, ['active', 'pending'], 'team.access.status');
		if (!('user_id' in row) || !('professional_id' in row))
			throw new InvalidDataContractError('team.access.identity.fields');
		const userId = readNullableText(row.user_id, 'team.access.user');
		const professionalId = readNullableText(row.professional_id, 'team.access.professional');
		if (status === 'active' && !userId) throw new InvalidDataContractError('team.access.identity');
		seen.add(id);
		return {
			id,
			business_id: scope,
			email,
			created_at: created,
			role: readChoice(row.role, BUSINESS_ROLES, 'team.access.role'),
			status,
			user_id: userId,
			professional_id: professionalId
		};
	});
}
export function parseRoleAccessOutcome(value: unknown): RoleAccessOutcome {
	const rows = readArray(value, 'team.access.outcome');
	if (rows.length !== 1) throw new InvalidDataContractError('team.access.outcome.length');
	const row = readRecord(rows[0], 'team.access.outcome.row');
	const status = readChoice(row.status, ROLE_ACCESS_OUTCOMES, 'team.access.outcome.status');
	const active = status === 'active' || status === 'already_active';
	const identifier = active
		? readText(row.membership_id, 'team.access.outcome.membership')
		: readText(row.invite_id, 'team.access.outcome.invite');
	if (!identifier || (active && !readText(row.user_id, 'team.access.outcome.user')))
		throw new InvalidDataContractError('team.access.outcome.identity');
	return status;
}

// Search and its optimistic preload use older JSON RPCs, while the daily agenda selects a
// relation. Enrich their authorized result in one bounded RLS read, so searching never removes
// a deposit label or its revision. No additional scan of patients or appointments.
import type { CitaSupabaseClient } from '$lib/types/database';
import { readArray, readChoice, readFiniteNumber, readRecord, readText, InvalidDataContractError } from '$lib/contracts/json';
import { DEPOSIT_STATUSES, DEPOSIT_WAIVED_REASONS } from '$lib/scheduling/deposits';

export async function withAgendaDeposits(supabase: CitaSupabaseClient, businessId: string, value: unknown) {
	const rows = readArray(value, 'agendaSearch').map(value => {
		const row = readRecord(value, 'agendaSearch.row');
		return { ...row, id: readText(row.id, 'agendaSearch.id'), starts_at: readText(row.starts_at, 'agendaSearch.startsAt'), status: readText(row.status, 'agendaSearch.status') };
	});
	if (!rows.length) return [];
	const ids = [...new Set(rows.map(row => row.id))];
	if (ids.length > 400) throw new InvalidDataContractError('agendaSearch.limit');
	const { data, error } = await supabase.from('appointment_deposits').select('appointment_id, status, revision, waived_reason')
		.eq('business_id', businessId).in('appointment_id', ids);
	if (error) throw error;
	const deposits = new Map<string, { status: (typeof DEPOSIT_STATUSES)[number]; revision: number; waived_reason: (typeof DEPOSIT_WAIVED_REASONS)[number] | null }>();
	for (const value of readArray(data, 'agendaSearch.deposits')) {
		const row = readRecord(value, 'agendaSearch.deposit');
		const id = readText(row.appointment_id, 'agendaSearch.deposit.id');
		const revision = readFiniteNumber(row.revision, 'agendaSearch.deposit.revision');
		if (!ids.includes(id) || deposits.has(id) || !Number.isSafeInteger(revision) || revision < 1) throw new InvalidDataContractError('agendaSearch.deposit');
		deposits.set(id, { status: readChoice(row.status, DEPOSIT_STATUSES, 'agendaSearch.deposit.status'), revision,
			waived_reason: row.waived_reason === null ? null : readChoice(row.waived_reason, DEPOSIT_WAIVED_REASONS, 'agendaSearch.deposit.waivedReason') });
	}
	return rows.map(row => ({ ...row, appointment_deposits: deposits.get(row.id) ?? null }));
}

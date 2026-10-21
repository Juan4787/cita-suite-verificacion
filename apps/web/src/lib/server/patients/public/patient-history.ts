import { isUuid } from '@cita-suite/shared/uuid';
import type { CitaSupabaseClient } from '$lib/types/database';
import type { BusinessContext } from '$lib/access/contracts';
import { readPatientHistoryEntry } from '$lib/patients/history-contract';
import { logServerFailure } from '$lib/server/platform/logging';
import { PatientOperationError } from './patient-operation-error';
import { resolvePatientPermissions } from './patient-permissions';

export const PATIENT_HISTORY_PAGE_SIZE = 30;
export type PatientHistoryCursor = { createdAt: string; id?: string };

/** Validate filter syntax before interpolating a compound PostgREST cursor. */
export function parsePatientHistoryCursor(
	createdAt: string,
	id: string,
	demo = false
): PatientHistoryCursor | null {
	if (!createdAt && !id) return null;
	const timestamp = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))?$/;
	if (
		!timestamp.test(createdAt) ||
		!Number.isFinite(Date.parse(createdAt)) ||
		(id && !(demo ? /^[\w-]{1,100}$/.test(id) : isUuid(id)))
	) {
		throw new PatientOperationError(
			'invalid',
			'No pudimos continuar el historial. Recargá la ficha y volvé a intentar.'
		);
	}
	return { createdAt, ...(id ? { id } : {}) };
}

/** User-scoped read: RLS stays active and a failed cost projection fails the page. */
export async function readPatientHistory({
	supabase,
	context,
	patientId,
	cursor
}: {
	supabase: CitaSupabaseClient;
	context: BusinessContext;
	patientId: string;
	cursor: PatientHistoryCursor | null;
}) {
	const permissions = resolvePatientPermissions(context);
	if (!permissions.canReadClinicalHistory)
		throw new PatientOperationError(
			'forbidden',
			'Tu usuario no puede consultar la historia clínica.'
		);
	let query = supabase
		.from('clinical_entries')
		.select(
			'id, created_at, entry_type, description, teeth, internal_note, created_by_user_id, locked_after'
		)
		.eq('patient_id', patientId)
		.eq('business_id', context.business.id)
		.is('archived_at', null)
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.limit(PATIENT_HISTORY_PAGE_SIZE + 1);
	if (cursor?.id)
		query = query.or(
			`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
		);
	else if (cursor) query = query.lt('created_at', cursor.createdAt);
	const { data, error } = await query;
	if (error) {
		logServerFailure('patient.history.page.failed', error);
		throw new PatientOperationError(
			'unavailable',
			'No se pudo cargar el historial. Volvé a intentar.'
		);
	}
	const rows = data ?? [];
	const hasMore = rows.length > PATIENT_HISTORY_PAGE_SIZE;
	const items = rows.slice(0, PATIENT_HISTORY_PAGE_SIZE);
	const costByEntry = new Map<string, number | null>();
	if (permissions.canViewCosts && items.length) {
		const { data: costs, error: costsError } = await supabase
			.from('clinical_entry_costs')
			.select('clinical_entry_id, amount')
			.eq('business_id', context.business.id)
			.in(
				'clinical_entry_id',
				items.map((item) => item.id)
			);
		if (costsError) {
			logServerFailure('patient.history.costs.failed', costsError);
			throw new PatientOperationError(
				'unavailable',
				'No se pudo cargar el historial completo. Volvé a intentar.'
			);
		}
		for (const cost of costs ?? []) costByEntry.set(cost.clinical_entry_id, cost.amount);
	}
	const projected = items.map((item) =>
		readPatientHistoryEntry({ ...item, amount: costByEntry.get(item.id) ?? null })
	);
	const last = projected.at(-1);
	return {
		items: projected,
		has_more: hasMore,
		next_cursor_created_at: hasMore ? (last?.created_at ?? null) : null,
		next_cursor_id: hasMore ? (last?.id ?? null) : null
	};
}

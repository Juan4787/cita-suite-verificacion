import type { Patient } from '$lib/types';
import { InvalidDataContractError, readArray, readBoolean, readChoice, readFiniteNumber, readNullableText, readRecord, readText } from './json';

type CountsSource = 'rpc' | 'fallback_planned';

export type PatientListData = {
	businessId: string | null;
	patients: Array<Pick<Patient, 'id' | 'full_name' | 'dni' | 'phone' | 'archived_at' | 'created_at' | 'updated_at' | 'last_entry_at'> & { professional_archived_at?: string | null }>;
	query: string;
	showArchived: boolean;
	demo: boolean;
	canCreatePatient: boolean;
	canAccessRadiographTrash: boolean;
	totalCount: number;
	activeCount: number;
	archivedCount: number;
	countsIncluded: boolean;
	countsSource: CountsSource;
	hasMore: boolean;
	nextCursor: string | null;
	snapshotAt: string | null;
	pageSize: number;
	cacheable: boolean;
	revision: string | null;
	cacheScope: string | null;
	loadedAt: string;
};

const contract = 'patients.list';
const readCount = (value: unknown) => {
	const count = readFiniteNumber(value, contract);
	if (!Number.isSafeInteger(count) || count < 0) throw new InvalidDataContractError(contract);
	return count;
};

/** A successful HTTP status alone cannot certify a complete list or its scope. */
export function parsePatientListData(value: unknown): PatientListData {
	const row = readRecord(value, contract);
	const businessId = readNullableText(row.businessId, contract);
	const cacheable = readBoolean(row.cacheable, contract);
	const revision = readNullableText(row.revision, contract);
	const cacheScope = readNullableText(row.cacheScope, contract);
	if (cacheable && (!businessId || !cacheScope || !revision || !/^\d+$/.test(revision))) {
		throw new InvalidDataContractError(contract);
	}
	const pageSize = readCount(row.pageSize);
	if (pageSize === 0) throw new InvalidDataContractError(contract);
	const loadedAt = readText(row.loadedAt, contract);
	if (!Number.isFinite(Date.parse(loadedAt))) throw new InvalidDataContractError(contract);
	return {
		businessId, cacheable, revision, cacheScope, pageSize, loadedAt,
		patients: readArray(row.patients, contract).map(value => {
			const patient = readRecord(value, contract);
			return {
				id: readText(patient.id, contract),
				full_name: readText(patient.full_name, contract),
				dni: readNullableText(patient.dni, contract),
				phone: readNullableText(patient.phone, contract),
				archived_at: readNullableText(patient.archived_at, contract),
				created_at: readNullableText(patient.created_at, contract),
				updated_at: readNullableText(patient.updated_at, contract),
				last_entry_at: readNullableText(patient.last_entry_at, contract),
				...('professional_archived_at' in patient
					? { professional_archived_at: readNullableText(patient.professional_archived_at, contract) }
					: {})
			};
		}),
		query: readText(row.query, contract),
		showArchived: readBoolean(row.showArchived, contract),
		demo: readBoolean(row.demo, contract),
		canCreatePatient: readBoolean(row.canCreatePatient, contract),
		canAccessRadiographTrash: readBoolean(row.canAccessRadiographTrash, contract),
		totalCount: readCount(row.totalCount),
		activeCount: readCount(row.activeCount),
		archivedCount: readCount(row.archivedCount),
		countsIncluded: readBoolean(row.countsIncluded, contract),
		countsSource: readChoice(row.countsSource, ['rpc', 'fallback_planned'], contract),
		hasMore: readBoolean(row.hasMore, contract),
		nextCursor: readNullableText(row.nextCursor, contract),
		snapshotAt: readNullableText(row.snapshotAt, contract)
	};
}

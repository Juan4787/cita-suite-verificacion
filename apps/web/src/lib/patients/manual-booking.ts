import type { CitaRow } from '$lib/types/database';
import {
	InvalidDataContractError,
	readArray,
	readBoolean,
	readNullableText,
	readRecord,
	readText
} from '$lib/contracts/json';

export type ManualBookingPatient = Pick<
	CitaRow<'patients'>,
	| 'id'
	| 'full_name'
	| 'phone'
	| 'phone_raw'
	| 'phone_e164'
	| 'dni'
	| 'birth_date'
	| 'activity_at'
	| 'blocked'
>;

/** Search returns a bounded complete projection, never an implicit empty fallback. */
export function readManualBookingPatients(value: unknown): ManualBookingPatient[] {
	const contract = 'patients.manualBookingSearch';
	const rows = readArray(readRecord(value, contract).patients, contract);
	if (rows.length > 12) throw new InvalidDataContractError(contract);
	const patients = rows.map((value) => {
		const row = readRecord(value, contract);
		const id = readText(row.id, contract),
			name = readText(row.full_name, contract);
		const activity = readText(row.activity_at, contract);
		if (!id.trim() || !name.trim() || !Number.isFinite(Date.parse(activity)))
			throw new InvalidDataContractError(contract);
		return {
			id,
			full_name: name,
			activity_at: activity,
			phone: readNullableText(row.phone, contract),
			phone_raw: readNullableText(row.phone_raw, contract),
			phone_e164: readNullableText(row.phone_e164, contract),
			dni: readNullableText(row.dni, contract),
			birth_date: readNullableText(row.birth_date, contract),
			blocked: readBoolean(row.blocked, contract)
		};
	});
	if (new Set(patients.map((row) => row.id)).size !== patients.length)
		throw new InvalidDataContractError(contract);
	return patients;
}

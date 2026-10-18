import {
	InvalidDataContractError,
	readArray,
	readBoolean,
	readFiniteNumber,
	readJson,
	readNullableText,
	readRecord,
	readText
} from '$lib/contracts/json';
import type { PatientHistoryEntry, PatientChangeEvent } from './contracts';
export type SavedPatientEntry = PatientHistoryEntry & {
	patient_id: string;
	teeth: string | null;
	internal_note: string | null;
	amount: number | null;
	created_by_user_id: string | null;
	locked_after: string | null;
};

function text(value: unknown, name: string) {
	const valueText = readText(value, name);
	if (!valueText) throw new InvalidDataContractError(name);
	return valueText;
}
function timestamp(value: unknown, name: string) {
	const valueText = text(value, name);
	patientHistoryInstant(valueText);
	return valueText;
}
/** PostgreSQL timestamps retain microseconds; Date.parse alone loses their order. */
function patientHistoryInstant(value: string): bigint {
	const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
		value
	);
	if (!parts) throw new InvalidDataContractError('patientHistory.timestamp');
	const wholeSecond = Date.parse(parts[1] + parts[3]);
	if (!Number.isFinite(wholeSecond)) throw new InvalidDataContractError('patientHistory.timestamp');
	return BigInt(wholeSecond) * 1000n + BigInt((parts[2] ?? '').padEnd(6, '0'));
}
export function comparePatientHistoryEntries(
	left: { created_at: string; id: string },
	right: { created_at: string; id: string }
): number {
	const a = patientHistoryInstant(left.created_at),
		b = patientHistoryInstant(right.created_at);
	if (a !== b) return a > b ? -1 : 1;
	return left.id === right.id ? 0 : left.id > right.id ? -1 : 1;
}
export function readPatientHistoryEntry(value: unknown): PatientHistoryEntry {
	const row = readRecord(value, 'patientHistory.entry');
	return {
		id: text(row.id, 'patientHistory.id'),
		created_at: timestamp(row.created_at, 'patientHistory.createdAt'),
		entry_type: readText(row.entry_type, 'patientHistory.type'),
		description: readText(row.description, 'patientHistory.description'),
		...(row.title === undefined ? {} : { title: readText(row.title, 'patientHistory.title') }),
		teeth: readNullableText(row.teeth, 'patientHistory.teeth'),
		internal_note: readNullableText(row.internal_note, 'patientHistory.note'),
		amount: row.amount == null ? null : readFiniteNumber(row.amount, 'patientHistory.amount'),
		created_by_user_id: readNullableText(row.created_by_user_id, 'patientHistory.author'),
		locked_after: readNullableText(row.locked_after, 'patientHistory.lockedAfter')
	};
}
export function readSavedPatientEntry(value: unknown, patientId: string): SavedPatientEntry {
	const row = readRecord(value, 'patientHistory.saved');
	if (row.patient_id !== patientId) throw new InvalidDataContractError('patientHistory.patient');
	const entry = readPatientHistoryEntry(row);
	return {
		...entry,
		patient_id: patientId,
		teeth: entry.teeth ?? null,
		internal_note: entry.internal_note ?? null,
		amount: entry.amount ?? null,
		created_by_user_id: entry.created_by_user_id ?? null,
		locked_after: entry.locked_after ?? null
	};
}
export function readPatientHistoryPage(
	value: unknown,
	cursor?: { created_at: string; id: string }
) {
	const payload = readRecord(value, 'patientHistory.page');
	const items = readArray(payload.items, 'patientHistory.items').map(readPatientHistoryEntry);
	const has_more = readBoolean(payload.has_more, 'patientHistory.hasMore');
	const nextCreatedAt = readNullableText(
		payload.next_cursor_created_at,
		'patientHistory.nextCreatedAt'
	);
	const nextId = readNullableText(payload.next_cursor_id, 'patientHistory.nextId');
	if (items.length > 30 || new Set(items.map((row) => row.id)).size !== items.length)
		throw new InvalidDataContractError('patientHistory.pageSize');
	let previous = cursor;
	for (const row of items) {
		if (previous && comparePatientHistoryEntries(previous, row) >= 0)
			throw new InvalidDataContractError('patientHistory.order');
		previous = row;
	}
	const last = items.at(-1);
	if (has_more && (!last || nextCreatedAt !== last.created_at || nextId !== last.id))
		throw new InvalidDataContractError('patientHistory.cursor');
	if (!has_more && (nextCreatedAt !== null || nextId !== null))
		throw new InvalidDataContractError('patientHistory.cursor');
	return { items, has_more };
}
export function readPatientChangeEvents(value: unknown): PatientChangeEvent[] {
	const payload = readRecord(value, 'patientChanges.page');
	const rows = readArray(payload.change_events, 'patientChanges.events');
	if (rows.length > 5) throw new InvalidDataContractError('patientChanges.pageSize');
	return rows.map((value) => {
		const row = readRecord(value, 'patientChanges.event');
		return {
			id: text(row.id, 'patientChanges.id'),
			summary: readText(row.summary, 'patientChanges.summary'),
			changed_by_name: readText(row.changed_by_name, 'patientChanges.author'),
			created_at: timestamp(row.created_at, 'patientChanges.createdAt'),
			...(row.changed_fields === undefined
				? {}
				: { changed_fields: readJson(row.changed_fields, 'patientChanges.fields') })
		};
	});
}

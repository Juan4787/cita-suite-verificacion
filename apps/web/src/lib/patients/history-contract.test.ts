import { describe, expect, it } from 'vitest';
import { InvalidDataContractError } from '$lib/contracts/json';
import {
	readPatientHistoryPage,
	comparePatientHistoryEntries,
	readPatientChangeEvents,
	readSavedPatientEntry
} from './history-contract';

const row = (id = 'b', date = '2026-01-02T12:00:00Z') => ({
	id,
	created_at: date,
	entry_type: 'Consulta',
	description: 'Synthetic history',
	teeth: null,
	internal_note: null,
	amount: 125.5,
	created_by_user_id: null,
	locked_after: null
});
const page = () => ({
	items: [row()],
	has_more: true,
	next_cursor_created_at: row().created_at,
	next_cursor_id: 'b'
});

describe('patient history HTTP contract', () => {
	it('preserves PostgreSQL microseconds and equivalent timezone representations during pagination and merging', () => {
		const newest = row('a', '2026-01-02T12:00:00.000002Z');
		const older = row('z', '2026-01-02T09:00:00.000001-03:00');
		expect(readPatientHistoryPage({ items: [newest, older], has_more: false }).items).toHaveLength(
			2
		);
		expect([older, newest].sort(comparePatientHistoryEntries)[0]).toBe(newest);
		expect(() => readPatientHistoryPage({ items: [older, newest], has_more: false })).toThrow(
			InvalidDataContractError
		);
	});
	it('accepts an authoritative empty page and preserves historical decimal clinical costs', () => {
		expect(readPatientHistoryPage({ items: [], has_more: false })).toEqual({
			items: [],
			has_more: false
		});
		expect(readPatientHistoryPage(page()).items[0].amount).toBe(125.5);
	});
	it('rejects incomplete success, invalid continuation, duplicates and unordered rows before they enter the view', () => {
		for (const value of [
			{},
			{ items: null, has_more: false },
			{ items: [], has_more: 'false' },
			{ ...page(), next_cursor_id: null },
			{ ...page(), next_cursor_created_at: null },
			{ ...page(), items: [row(), row()] },
			{ ...page(), items: [row('a', '2026-01-01T12:00:00Z'), row('b')] },
			{ ...page(), items: [], has_more: true },
			{ ...page(), has_more: false }
		])
			expect(() => readPatientHistoryPage(value)).toThrow(InvalidDataContractError);
	});
	it('checks that the returned rows really advance the requested cursor', () => {
		expect(() => readPatientHistoryPage(page(), { id: 'a', created_at: row().created_at })).toThrow(
			InvalidDataContractError
		);
		expect(
			readPatientHistoryPage(page(), { id: 'c', created_at: row().created_at }).items
		).toHaveLength(1);
	});
	it('does not merge a saved entry from another patient or coerce malformed amounts and notes', () => {
		expect(
			readSavedPatientEntry({ ...row(), patient_id: 'patient-one' }, 'patient-one').amount
		).toBe(125.5);
		for (const value of [
			{ ...row(), patient_id: 'patient-two' },
			{ ...row(), patient_id: 'patient-one', amount: '125.5' },
			{ ...row(), patient_id: 'patient-one', internal_note: { private: 'PRIVATE_SENTINEL' } }
		]) {
			try {
				readSavedPatientEntry(value, 'patient-one');
				throw new Error('Expected contract rejection');
			} catch (cause) {
				expect(cause).toBeInstanceOf(InvalidDataContractError);
				expect(String(cause)).not.toContain('PRIVATE_SENTINEL');
			}
		}
	});
	it('validates deferred change history instead of treating a partial 200 as no changes', () => {
		expect(readPatientChangeEvents({ change_events: [] })).toEqual([]);
		expect(
			readPatientChangeEvents({
				change_events: [
					{
						id: 'event',
						summary: 'Synthetic change',
						changed_by_name: 'Synthetic actor',
						created_at: row().created_at
					}
				]
			})
		).toHaveLength(1);
		for (const value of [{}, { change_events: null }, { change_events: [{}] }])
			expect(() => readPatientChangeEvents(value)).toThrow(InvalidDataContractError);
	});
});

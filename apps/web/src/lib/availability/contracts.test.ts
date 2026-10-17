import { describe, expect, it } from 'vitest';
import { parseAvailabilityCatalog, parseAvailabilityWindow } from './contracts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { businessId: id(1), scope: 'public' as const };
const catalog = () => ({
	schema_version: 2, business_id: id(1), scope: 'public', configuration_revision: 4, generated_at: '2026-10-17T12:00:00Z',
	business: { timezone: 'America/Argentina/Buenos_Aires', max_booking_days_ahead: 90, min_booking_notice_minutes: 60,
		is_active: true, public_booking_enabled: true },
	services: [{ id: id(2), business_id: id(1), name: 'Synthetic service', description: null, price_label: null, duration_minutes: 30,
		buffer_before_minutes: 15, buffer_after_minutes: 10, is_active: true, is_public: true, sort_order: 0 }],
	professionals: [{ id: id(3), name: 'Synthetic professional', specialty: null, avatar_url: null, is_active: true, is_public: true, sort_order: 0 }],
	assignments: [{ service_id: id(2), professional_id: id(3) }],
	rules: [{ id: id(4), professional_id: id(3), weekday: 1, start_time: '09:00:00', end_time: '19:00:00',
		slot_interval_minutes: 30, break_minutes: 15, is_active: true, service_scope: 'restricted', allowed_service_ids: [] }]
});
const expectedWindow = { ...scope, configurationRevision: 4, fromDate: '2026-10-19', toDate: '2026-11-02', professionalIds: [id(3)] };
const window = () => ({
	schema_version: 2, complete: true, business_id: id(1), scope: 'public', configuration_revision: 4,
	generated_at: '2026-10-17T12:00:00Z', from_date: '2026-10-19', to_date: '2026-11-02', professional_ids: [id(3)],
	counts: { exceptions: 0, blocks: 1 }, exceptions: [],
	blocks: [{ id: id(5), appointment_id: id(6), professional_id: id(3), starts_at: '2026-10-19T09:30:00Z', ends_at: '2026-10-19T10:00:00Z',
		base_blocking_starts_at: '2026-10-19T09:15:00Z', base_blocking_ends_at: '2026-10-19T10:10:00Z',
		blocking_starts_at: '2026-10-19T09:15:00Z', blocking_ends_at: '2026-10-19T10:25:00Z' }]
});

describe('availability JSON boundaries', () => {
	it('preserves an explicitly restricted catalog rule after its last service is removed', () => {
		const parsed = parseAvailabilityCatalog(catalog(), scope);
		expect(parsed.rules[0]).toMatchObject({ service_scope: 'restricted', allowed_service_ids: [], break_minutes: 15 });
	});
	it('rejects a partial catalog and malformed dates, numerical fields or relationships', () => {
		expect(() => parseAvailabilityCatalog({ ...catalog(), rules: undefined }, scope)).toThrow();
		expect(() => parseAvailabilityCatalog({ ...catalog(), generated_at: '2026-02-30T12:00:00Z' }, scope)).toThrow();
		const badDuration = catalog(); badDuration.services[0].duration_minutes = -1;
		expect(() => parseAvailabilityCatalog(badDuration, scope)).toThrow();
		const badLink = catalog(); badLink.assignments[0].professional_id = id(99);
		expect(() => parseAvailabilityCatalog(badLink, scope)).toThrow();
	});
	it('does not accept a foreign clinic, private professional or changed scope as an empty catalog', () => {
		expect(() => parseAvailabilityCatalog({ ...catalog(), business_id: id(99) }, scope)).toThrow();
		expect(() => parseAvailabilityCatalog({ ...catalog(), scope: 'internal' }, scope)).toThrow();
		const privateRow = catalog(); privateRow.professionals[0].is_public = false;
		expect(() => parseAvailabilityCatalog(privateRow, scope)).toThrow();
	});
	it('preserves base occupancy, service buffers and expanded break intervals', () => {
		const parsed = parseAvailabilityWindow(window(), expectedWindow);
		expect(parsed.blocks[0]).toMatchObject({ base_blocking_ends_at: '2026-10-19T10:10:00Z', blocking_ends_at: '2026-10-19T10:25:00Z' });
	});
	it('fails explicitly on missing rows, fields, completeness or mismatched version/range', () => {
		expect(() => parseAvailabilityWindow({ ...window(), blocks: [] }, expectedWindow)).toThrow();
		expect(() => parseAvailabilityWindow({ ...window(), complete: false }, expectedWindow)).toThrow();
		expect(() => parseAvailabilityWindow({ ...window(), configuration_revision: 5 }, expectedWindow)).toThrow();
		expect(() => parseAvailabilityWindow({ ...window(), to_date: '2026-11-03' }, expectedWindow)).toThrow();
		const missingBase = { ...window(), blocks: window().blocks.map(({ base_blocking_ends_at: _base, ...row }) => row) };
		expect(() => parseAvailabilityWindow(missingBase, expectedWindow)).toThrow();
	});
	it('rejects foreign and duplicate allocations and invalid interval ordering', () => {
		expect(() => parseAvailabilityWindow({ ...window(), professional_ids: [id(99)] }, expectedWindow)).toThrow();
		const duplicate = window(); duplicate.blocks.push({ ...duplicate.blocks[0] }); duplicate.counts.blocks = 2;
		expect(() => parseAvailabilityWindow(duplicate, expectedWindow)).toThrow();
		const invalidRange = window(); invalidRange.blocks[0].blocking_ends_at = '2026-10-19T09:50:00Z';
		expect(() => parseAvailabilityWindow(invalidRange, expectedWindow)).toThrow();
	});
	it('accepts a genuinely empty, explicitly complete window', () => {
		const empty = { ...window(), blocks: [], counts: { blocks: 0, exceptions: 0 } };
		expect(parseAvailabilityWindow(empty, expectedWindow).blocks).toEqual([]);
	});
});

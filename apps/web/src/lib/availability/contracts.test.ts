import { describe, expect, it } from 'vitest';
import { parseAvailabilityCatalog, parseAvailabilityWindow } from './contracts';

import { id, scope, catalog, expectedWindow, window } from './__fixtures__/availability';

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

import { describe, expect, it } from 'vitest';
import { id, catalog, window as occupancy } from './__fixtures__/availability';
import { parseAvailabilitySnapshot, parseAvailabilitySlots } from './http';
const slot = { date: '2026-10-20', time: '09:00', starts_at: '2026-10-20T12:00:00Z', ends_at: '2026-10-20T12:30:00Z',
 professional_id: 'synthetic-professional', professional_name: 'Synthetic professional', professional_ids: ['synthetic-professional'],
 professional_names: ['Synthetic professional'], is_joint: false };
const expected = { fromDate: '2026-10-20', toDate: '2026-10-26', professionalIds: ['synthetic-professional'] };
describe('availability HTTP boundary', () => {
 it('accepts a genuinely empty response and complete individual options', () => {
  expect(parseAvailabilitySlots({ slots: [] }, expected)).toEqual([]);
  expect(parseAvailabilitySlots({ slots: [slot] }, expected)).toEqual([slot]);
 });
 it('accepts the existing individual projection without optional team fields', () => {
  const { professional_ids: _ids, professional_names: _names, is_joint: _joint, ...individual } = slot;
  expect(parseAvailabilitySlots({ slots: [individual] }, expected)).toEqual([slot]);
 });
 it.each([{}, { slots: null }, { slots: [{}] }, { slots: [slot, slot] },
  { slots: [{ ...slot, date: '2026-10-27' }] }, { slots: [{ ...slot, ends_at: slot.starts_at }] },
  { slots: [{ ...slot, professional_ids: ['another-professional'], professional_id: 'another-professional' }] },
  { slots: [{ ...slot, professional_names: [] }] }, { slots: [{ ...slot, is_joint: true }] }])(
  'rejects partial, contradictory or out-of-selection success: %j', value => expect(() => parseAvailabilitySlots(value, expected)).toThrow()
 );
});

const snapshot = () => ({ ...catalog(), ...occupancy(), schema_version: 1, valid_until: '2026-10-17T12:00:20Z' });
const snapshotExpected = { businessId: id(1), date: '2026-10-20' };
describe('internal snapshot HTTP boundary', () => {
 it('validates the v1 projection using the same configuration/interval contracts', () => {
  const parsed = parseAvailabilitySnapshot(snapshot(), snapshotExpected);
  expect(parsed.schema_version).toBe(1);
  expect(parsed.blocks).toHaveLength(1);
  expect(parsed.services[0]).not.toHaveProperty('description');
  expect(parsed.professionals[0]).not.toHaveProperty('avatar_url');
 });
 it.each(['services', 'professionals', 'rules', 'assignments', 'exceptions', 'blocks'])('rejects a missing %s array', field => {
  const broken: Record<string, unknown> = snapshot(); delete broken[field];
  expect(() => parseAvailabilitySnapshot(broken, snapshotExpected)).toThrow();
 });
 it('rejects snapshots outside the requested date, for another clinic, or with an invalid interval', () => {
  expect(() => parseAvailabilitySnapshot(snapshot(), { ...snapshotExpected, date: '2026-11-03' })).toThrow();
  expect(() => parseAvailabilitySnapshot(snapshot(), { ...snapshotExpected, businessId: id(99) })).toThrow();
  const broken = snapshot(); broken.blocks[0].base_blocking_starts_at = '2026-10-19T09:45:00Z';
  expect(() => parseAvailabilitySnapshot(broken, snapshotExpected)).toThrow();
 });
});

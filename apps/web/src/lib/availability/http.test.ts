import { describe, expect, it } from 'vitest';
import { parseAvailabilitySlots } from './http';
const slot = { date: '2026-10-20', time: '09:00', starts_at: '2026-10-20T12:00:00Z', ends_at: '2026-10-20T12:30:00Z',
 professional_id: 'synthetic-professional', professional_name: 'Synthetic professional', professional_ids: ['synthetic-professional'],
 professional_names: ['Synthetic professional'], is_joint: false };
const expected = { fromDate: '2026-10-20', toDate: '2026-10-26', professionalIds: ['synthetic-professional'] };
describe('availability HTTP boundary', () => {
 it('accepts a genuinely empty response and complete individual options', () => {
  expect(parseAvailabilitySlots({ slots: [] }, expected)).toEqual([]);
  expect(parseAvailabilitySlots({ slots: [slot] }, expected)).toEqual([slot]);
 });
 it.each([{}, { slots: null }, { slots: [{}] }, { slots: [slot, slot] },
  { slots: [{ ...slot, date: '2026-10-27' }] }, { slots: [{ ...slot, ends_at: slot.starts_at }] },
  { slots: [{ ...slot, professional_ids: ['another-professional'], professional_id: 'another-professional' }] },
  { slots: [{ ...slot, professional_names: [] }] }, { slots: [{ ...slot, is_joint: true }] }])(
  'rejects partial, contradictory or out-of-selection success: %j', value => expect(() => parseAvailabilitySlots(value, expected)).toThrow()
 );
});

import { describe, expect, it } from 'vitest';
import { readClinicalEntryAmount } from '$lib/server/patients/public/clinical-entry-costs';
import { InvalidDataContractError } from '$lib/contracts/json';

describe('clinical cost relationship migration compatibility', () => {
  it('keeps legacy arrays and composite one-to-one objects equivalent, including zero', () => {
    for (const amount of [null, 0, 15000.50]) {
      expect(readClinicalEntryAmount([{ amount }])).toBe(amount);
      expect(readClinicalEntryAmount({ amount })).toBe(amount);
    }
    for (const absent of [null, undefined, []]) expect(readClinicalEntryAmount(absent)).toBeNull();
  });
  it('rejects malformed amounts rather than hiding a changed relationship contract', () => {
    for (const malformed of [{}, { amount: '15000' }, { amount: NaN }, [false]])
      expect(() => readClinicalEntryAmount(malformed)).toThrow(InvalidDataContractError);
  });
});

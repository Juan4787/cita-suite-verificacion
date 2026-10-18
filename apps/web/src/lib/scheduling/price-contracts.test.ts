import { describe, expect, it } from 'vitest';
import { InvalidDataContractError } from '$lib/contracts/json';
import { parsePriceQuote, parseServicePriceLabels } from '$lib/scheduling/price-contracts';
import { parsePublicCatalogue, parsePublicContactResponse } from '$lib/sites/catalogue';

const quote = { amount: 21016, base_amount: 20000, current_amount: 20000, currency: 'ARS', date: '2027-01-15', month: '2027-01-01', adjusted: true, hash: 'binding', revision: 1, policy_id: 'policy' };
const contact = { phone: null, address: 'Consultorio sintético', whatsapp_phone: null, whatsapp_message: null };
describe('public JSON contracts', () => {
  it('keeps optional and absent historical price snapshots distinct from invalid quotes', () => {
    expect(parsePriceQuote(null)).toBeNull();
    expect(parsePriceQuote(quote)).toEqual(quote);
    const { current_amount, ...historical } = quote;
    expect(parsePriceQuote(historical)).toEqual(historical);
    for (const malformed of [{}, { ...quote, amount: 21016.08 }, { ...quote, revision: 0 }, { ...quote, adjusted: 'true' }, { ...quote, amount: '21016' }])
      expect(() => parsePriceQuote(malformed)).toThrow(InvalidDataContractError);
  });
  it('validates every price label and does not turn a broken response into an empty catalogue', () => {
    expect(parseServicePriceLabels([]).size).toBe(0);
    const row = { id: 'service', minimum: 10000, maximum: 12000, currency: 'ARS', mixed: false };
    expect(parseServicePriceLabels([row]).get('service')).toContain('Desde');
    expect(parseServicePriceLabels([{ ...row, mixed: true }]).get('service')).toBe('Arancel según profesional y fecha');
    for (const malformed of [null, {}, [{ ...row, minimum: null }], [row, row], [{ ...row, maximum: 9999 }]])
      expect(() => parseServicePriceLabels(malformed)).toThrow(InvalidDataContractError);
  });
  it('returns only the public contact contract and requires explicit allowed origins', () => {
    expect(parsePublicContactResponse({ allowed_origins: ['https://example.test'], contact: { ...contact, private_notes: 'excluded' } }))
      .toEqual({ allowedOrigins: ['https://example.test'], contact });
    for (const malformed of [null, { contact }, { allowed_origins: [null], contact }, { allowed_origins: [], contact: { phone: {} } }])
      expect(() => parsePublicContactResponse(malformed)).toThrow(InvalidDataContractError);
  });
  it('distinguishes a valid empty catalogue from incomplete, invalid services or unknown modalities', () => {
    const empty = { services: [], modalities: ['in_person'], contact };
    expect(parsePublicCatalogue(empty)).toEqual(empty);
    for (const malformed of [{}, { ...empty, services: null }, { ...empty, services: [{ id: 'service', name: 'Consulta', duration_minutes: 0 }] }, { ...empty, modalities: ['arbitrary'] }])
      expect(() => parsePublicCatalogue(malformed)).toThrow(InvalidDataContractError);
  });
});

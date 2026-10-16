import type { PriceQuote } from '$lib/booking/pricing';
import { formatQuotedPrice } from '$lib/booking/pricing';
import { InvalidDataContractError, readArray, readBoolean, readFiniteNumber, readJson, readRecord, readText } from '$lib/contracts/json';

export function parsePriceQuote(value: unknown): PriceQuote | null {
  if (value === null || value === undefined) return null;
  const row = readRecord(readJson(value, 'priceQuote'), 'priceQuote');
  const amount = readFiniteNumber(row.amount, 'priceQuote.amount');
  const base_amount = readFiniteNumber(row.base_amount, 'priceQuote.base_amount');
  const revision = readFiniteNumber(row.revision, 'priceQuote.revision');
  const current_amount = row.current_amount === undefined ? undefined : readFiniteNumber(row.current_amount, 'priceQuote.current_amount');
  if (![amount, base_amount, revision, ...(current_amount === undefined ? [] : [current_amount])].every(Number.isSafeInteger) ||
    amount < 0 || base_amount < 0 || revision < 1 || (current_amount !== undefined && current_amount < 0))
    throw new InvalidDataContractError('priceQuote.integerAmounts');
  return {
    ...row, amount, base_amount, ...(current_amount === undefined ? {} : { current_amount }), revision,
    currency: readText(row.currency, 'priceQuote.currency'),
    date: readText(row.date, 'priceQuote.date'), month: readText(row.month, 'priceQuote.month'),
    adjusted: readBoolean(row.adjusted, 'priceQuote.adjusted'),
    hash: readText(row.hash, 'priceQuote.hash'), policy_id: readText(row.policy_id, 'priceQuote.policy_id')
  };
}

/** One parser shared by the public page and the versioned catalogue endpoint. */
export function parseServicePriceLabels(value: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  for (const item of readArray(value, 'servicePriceLabels')) {
    const row = readRecord(item, 'servicePriceLabel');
    const id = readText(row.id, 'servicePriceLabel.id');
    const minimum = readFiniteNumber(row.minimum, 'servicePriceLabel.minimum');
    const maximum = readFiniteNumber(row.maximum, 'servicePriceLabel.maximum');
    const currency = readText(row.currency, 'servicePriceLabel.currency');
    const mixed = readBoolean(row.mixed, 'servicePriceLabel.mixed');
    if (labels.has(id) || !Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 0 || maximum < minimum)
      throw new InvalidDataContractError('servicePriceLabel.range');
    labels.set(id, mixed ? 'Arancel según profesional y fecha' : `${minimum !== maximum ? 'Desde ' : ''}${formatQuotedPrice({ amount: minimum, currency })}`);
  }
  return labels;
}

export function parsePriceAdjustments(value: unknown): import('$lib/booking/pricing').PriceAdjustment[] {
  return readArray(value, 'priceAdjustments').map(value => {
    const row = readRecord(value, 'priceAdjustment');
    if (row.kind !== 'default' && row.kind !== 'override') throw new InvalidDataContractError('priceAdjustment.kind');
    return { month: readText(row.month, 'priceAdjustment.month'), kind: row.kind, percentage: readFiniteNumber(row.percentage, 'priceAdjustment.percentage') };
  });
}

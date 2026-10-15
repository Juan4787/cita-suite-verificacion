export type PriceQuote = {
  amount: number;
  base_amount: number;
  current_amount?: number;
  currency: string;
  date: string;
  month: string;
  adjusted: boolean;
  hash: string;
  revision: number;
  policy_id: string;
};
export type PriceAdjustment = {
  month: string;
  kind: "default" | "override";
  percentage: number;
};
export function monthForTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}
export const formatQuotedPrice = (
  quote: Pick<PriceQuote, "amount" | "currency">,
) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: quote.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(quote.amount);
const invalid = () => new Error("PRICE_CONFIGURATION_INVALID");
const percentageUnits = (text: string) => {
  const match = /^(\d+)(?:[.,](\d{1,4}))?$/.exec(text);
  if (!match) throw invalid();
  const rate =
    BigInt(match[1]) * 10000n + BigInt((match[2] ?? "").padEnd(4, "0") || "0");
  if (rate > 10000000n) throw invalid();
  return rate;
};
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
export function previewMonthlyPrices(
  base: string,
  monthly: string,
  rounding: string,
  baseMonth: string,
  firstMonth: string,
  adjustments: PriceAdjustment[],
  count = 6,
  startMonth = baseMonth,
) {
  if (
    !/^\d+$/.test(base) ||
    !/^\d+$/.test(rounding) ||
    !monthPattern.test(baseMonth) ||
    !monthPattern.test(firstMonth) ||
    !monthPattern.test(startMonth) ||
    firstMonth <= baseMonth ||
    adjustments.length > 120
  )
    throw invalid();
  const unit = BigInt(rounding);
  let numerator = BigInt(base);
  let denominator = 1n;
  const recurring = percentageUnits(monthly);
  if (unit < 1n || unit > 1000n || numerator > 1000000000000n) throw invalid();
  const keys = new Set<string>();
  for (const row of adjustments) {
    const key = row.month + row.kind;
    if (
      !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(row.month) ||
      row.month.slice(0, 7) <= baseMonth ||
      !["default", "override"].includes(row.kind) ||
      keys.has(key) ||
      !Number.isFinite(row.percentage)
    )
      throw invalid();
    keys.add(key);
    percentageUnits(String(row.percentage));
  }
  const [year, month] = baseMonth.split("-").map(Number);
  const [startYear, startNumber] = startMonth.split("-").map(Number);
  const startOffset = Math.max(
    0,
    (startYear - year) * 12 + startNumber - month,
  );
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 120 ||
    startOffset + count > 600
  )
    throw invalid();
  const result = [];
  const defaults = adjustments
    .filter((row) => row.kind === "default")
    .sort((a, b) => a.month.localeCompare(b.month));
  for (let offset = 0; offset < startOffset + count; offset++) {
    const absolute = year * 12 + month - 1 + offset;
    const current = `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, "0")}`;
    if (offset > 0) {
      let rate = current < firstMonth ? 0n : recurring;
      if (current >= firstMonth)
        for (const row of defaults)
          if (row.month.slice(0, 7) <= current)
            rate = percentageUnits(String(row.percentage));
      const override = adjustments.find(
        (row) => row.kind === "override" && row.month.slice(0, 7) === current,
      );
      if (override) rate = percentageUnits(String(override.percentage));
      numerator *= 1000000n + rate;
      denominator *= 1000000n;
    }
    if (numerator > 1000000000000n * denominator)
      throw new Error("PRICE_AMOUNT_INVALID");
    // Round only this month's quote. Keep the exact rational series unchanged.
    const divisor = denominator * unit;
    const amount = ((numerator * 2n + divisor) / (divisor * 2n)) * unit;
    if (offset >= startOffset)
      result.push({ month: current, amount: Number(amount) });
  }
  return result;
}

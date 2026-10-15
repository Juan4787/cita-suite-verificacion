import { describe, it, expect } from "vitest";
import { previewMonthlyPrices, monthForTimezone } from "./pricing";
describe("monthly fee calculation", () => {
  it("compounds with exact internal precision and whole peso quotes and replaces the default in exceptional months", () => {
    const rows = previewMonthlyPrices("20000", "2", "1", "2026-10", "2026-11", [
      { month: "2027-01-01", kind: "override", percentage: 1 },
      { month: "2027-02-01", kind: "override", percentage: 0 },
    ]);
    expect(rows.map((row) => row.amount)).toEqual([
      20000, 20400, 20808, 21016, 21016, 21436,
    ]);
  });
  it("changes the recurring percentage without erasing a later exception", () => {
    const rows = previewMonthlyPrices("1000", "2", "1", "2026-10", "2026-11", [
      { month: "2026-12-01", kind: "default", percentage: 3 },
      { month: "2027-01-01", kind: "override", percentage: 0 },
    ]);
    expect(rows.map((row) => row.amount)).toEqual([
      1000, 1020, 1051, 1051, 1082, 1115,
    ]);
  });
  it("rounds half upward without a binary floating point discrepancy", () => {
    expect(
      previewMonthlyPrices("15", "50", "1", "2026-10", "2026-11", [])[1].amount,
    ).toBe(23);
    expect(
      previewMonthlyPrices("100", "2", "100", "2026-10", "2026-11", [])[1]
        .amount,
    ).toBe(100);
  });
  it.each([
    ["20.001", "2", "1"],
    ["20", "2.00001", "1"],
    ["20", "-2", "1"],
    ["20", "2", "0"],
  ])(
    "rejects unsupported precision and negative or zero controls",
    (base, rate, rounding) => {
      expect(() =>
        previewMonthlyPrices(base, rate, rounding, "2026-10", "2026-11", []),
      ).toThrow();
    },
  );
  it("shows upcoming months even when the reference month is old", () => {
    expect(
      previewMonthlyPrices(
        "1000",
        "2",
        "1",
        "2026-01",
        "2026-02",
        [],
        2,
        "2026-03",
      ),
    ).toEqual([
      { month: "2026-03", amount: 1040 },
      { month: "2026-04", amount: 1061 },
    ]);
  });
  it("does not chain a rounded monthly quote into the following calculation", () => {
    expect(
      previewMonthlyPrices("1000", "2", "100", "2026-10", "2026-11", [], 4).map(
        (row) => row.amount,
      ),
    ).toEqual([1000, 1000, 1000, 1100]);
  });
  it("uses the practice timezone at a month boundary", () => {
    expect(
      monthForTimezone(
        new Date("2026-11-01T01:00:00Z"),
        "America/Argentina/Buenos_Aires",
      ),
    ).toBe("2026-10");
  });
});

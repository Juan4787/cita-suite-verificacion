import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateAvailabilitySlots,
  type AvailabilityRuleRow,
} from "./calculate";

// Workers Free allows 10 ms of CPU per request, and building an
// Intl.DateTimeFormat costs far more than formatting with one.
const weekdays = [1, 2, 3, 4, 5];
const rules: AvailabilityRuleRow[] = ["p1", "p2"].flatMap((professional) =>
  weekdays.map((weekday) => ({
    id: `${professional}-${weekday}`,
    professional_id: professional,
    weekday,
    start_time: "09:00",
    end_time: "18:00",
    slot_interval_minutes: 30,
    is_active: true,
  })),
);

const twoWeeks = () =>
  calculateAvailabilitySlots({
    business: {
      timezone: "America/Argentina/Buenos_Aires",
      is_active: true,
      public_booking_enabled: true,
      max_booking_days_ahead: 60,
      min_booking_notice_minutes: 0,
    },
    service: {
      id: "s1",
      business_id: "b",
      name: "Synthetic service",
      duration_minutes: 30,
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
      is_public: true,
      is_active: true,
    },
    professionals: [
      { id: "p1", name: "Professional One", is_public: true, is_active: true },
      { id: "p2", name: "Professional Two", is_public: true, is_active: true },
    ],
    rules,
    exceptions: [],
    blocks: [],
    fromDate: "2026-06-22",
    toDate: "2026-07-05",
    now: new Date("2026-06-20T00:00:00Z"),
    publicOnly: true,
  });

// Counts the formatters built while delegating to the real constructor, so the
// calculation behaves exactly as it would without the count.
const countFormatters = () => {
  const counter = { built: 0 };
  const DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
    construct(target, args) {
      counter.built++;
      return Reflect.construct(target, args);
    },
    apply(target, thisArg, args) {
      counter.built++;
      return Reflect.apply(target, thisArg, args);
    },
  });
  vi.stubGlobal(
    "Intl",
    new Proxy(Intl, {
      get: (target, key) =>
        key === "DateTimeFormat" ? DateTimeFormat : Reflect.get(target, key),
    }),
  );
  return counter;
};

describe("Time zone formatting cost of the shared availability calculator", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("builds each formatter of a time zone once, however many dates, rules and slots it formats", () => {
    const counter = countFormatters();
    const slots = twoWeeks();
    expect(slots.length).toBeGreaterThan(300);
    // One per shape and time zone at most: offset, local parts and weekday.
    expect(counter.built).toBeLessThanOrEqual(3);
    counter.built = 0;
    expect(twoWeeks()).toEqual(slots);
    expect(counter.built).toBe(0);
  });
});

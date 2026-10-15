import { describe, expect, it } from "vitest";
import {
  calculateAvailabilitySlots,
  type AvailabilityRuleRow,
  type AvailabilityExceptionRow,
} from "./calculate";
const date = "2026-06-22";
const general: AvailabilityRuleRow = {
  id: "general",
  professional_id: "p1",
  weekday: 1,
  start_time: "14:00",
  end_time: "17:00",
  slot_interval_minutes: 30,
  is_active: true,
};
const followups: AvailabilityRuleRow = {
  id: "followups",
  professional_id: "p1",
  weekday: 1,
  start_time: "17:00",
  end_time: "19:00",
  slot_interval_minutes: 30,
  is_active: true,
  service_scope: "restricted",
  allowed_service_ids: ["followup"],
};
function slots(
  serviceId: string,
  options: {
    after?: number;
    exceptions?: AvailabilityExceptionRow[];
    allowed?: string[];
    team?: boolean;
  } = {},
) {
  return calculateAvailabilitySlots({
    business: {
      timezone: "UTC",
      is_active: true,
      public_booking_enabled: true,
      max_booking_days_ahead: 30,
      min_booking_notice_minutes: 0,
    },
    service: {
      id: serviceId,
      business_id: "b",
      name: "Synthetic service",
      duration_minutes: 30,
      buffer_before_minutes: 0,
      buffer_after_minutes: options.after ?? 0,
      is_public: true,
      is_active: true,
    },
    professionals: [
      { id: "p1", name: "Professional One", is_public: true, is_active: true },
      ...(options.team
        ? [
            {
              id: "p2",
              name: "Professional Two",
              is_public: true,
              is_active: true,
            },
          ]
        : []),
    ],
    rules: [
      general,
      {
        ...followups,
        allowed_service_ids: options.allowed ?? followups.allowed_service_ids,
      },
      ...(options.team
        ? [{ ...general, id: "p2", professional_id: "p2", end_time: "19:00" }]
        : []),
    ],
    exceptions: options.exceptions ?? [],
    blocks: [],
    fromDate: date,
    toDate: date,
    now: new Date("2026-06-20T00:00:00Z"),
    publicOnly: true,
    ...(options.team ? { requiredProfessionalIds: ["p1", "p2"] } : {}),
  });
}
describe("Service restrictions in the shared availability calculator", () => {
  it("keeps adjacent general and follow-up windows distinct", () => {
    expect(slots("general").map((s) => s.time)).toEqual([
      "14:00",
      "14:30",
      "15:00",
      "15:30",
      "16:00",
      "16:30",
    ]);
    expect(slots("followup").map((s) => s.time)).toContain("17:00");
  });
  it("keeps an empty restriction closed even with extra availability", () => {
    const extra: AvailabilityExceptionRow = {
      id: "extra",
      professional_id: "p1",
      type: "extra_available",
      starts_at: date + "T17:00:00Z",
      ends_at: date + "T19:00:00Z",
    };
    expect(
      slots("followup", { allowed: [], exceptions: [extra] }).every(
        (s) => s.time < "17:00",
      ),
    ).toBe(true);
  });
  it("excludes a general appointment whose buffer crosses the follow-up boundary", () => {
    expect(slots("general", { after: 15 }).map((s) => s.time)).not.toContain(
      "16:30",
    );
    expect(slots("general", { after: 15 }).map((s) => s.time)).toContain(
      "16:00",
    );
  });
  it("applies a dated global restriction to every participant", () => {
    const restriction: AvailabilityExceptionRow = {
      id: "date",
      professional_id: null,
      type: "restricted",
      starts_at: date + "T15:00:00Z",
      ends_at: date + "T16:00:00Z",
      allowed_service_ids: ["followup"],
    };
    expect(
      slots("general", { team: true, exceptions: [restriction] }).map(
        (s) => s.time,
      ),
    ).not.toContain("15:00");
    expect(
      slots("followup", { team: true, exceptions: [restriction] }).map(
        (s) => s.time,
      ),
    ).toContain("15:00");
    expect(
      slots("general", { team: true }).every((s) => s.time < "17:00"),
    ).toBe(true);
  });
});

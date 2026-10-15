import { describe, it, expect } from "vitest";
import { parseBookingSettings } from "./booking-settings";
import { bookingProfileConfig } from "./booking-profile-config";
import { readBoundedBookingForm } from "./public-booking-page";
function settings(max = "60", notice = "120") {
  const form = new FormData();
  form.set("max_booking_days_ahead", max);
  form.set("min_booking_notice_minutes", notice);
  form.set("cancellation_policy", " Avisar con tiempo. ");
  return form;
}
describe("separated booking configuration", () => {
  it("only updates booking rules and trims the cancellation text", () =>
    expect(parseBookingSettings(settings())).toEqual({
      max_booking_days_ahead: 60,
      min_booking_notice_minutes: 120,
      cancellation_policy: "Avisar con tiempo.",
    }));
  it.each([
    ["0", "120"],
    ["91", "120"],
    ["60", "10081"],
    ["60", "1.5"],
    ["60", ""],
    ["", "120"],
  ])("rejects invalid or missing limits %s %s", (max, notice) =>
    expect(() => parseBookingSettings(settings(max, notice))).toThrow(),
  );
  it("refuses excessive cancellation text", () => {
    const form = settings();
    form.set("cancellation_policy", "x".repeat(2001));
    expect(() => parseBookingSettings(form)).toThrow();
  });
  it("accepts structured website rows and multiple offered services", async () => {
    const body = new URLSearchParams({
      name: "Web de prueba",
      theme: "cita-suite",
      intake_schema: "[]",
      modality_windows: "[]",
    });
    body.append("origins", "https://EXAMPLE.test/");
    body.append("origins", "https://other.test");
    body.append("professional_ids", "10000000-0000-4000-8000-000000000001");
    body.append("service_ids", "10000000-0000-4000-8000-000000000002");
    body.append("service_ids", "10000000-0000-4000-8000-000000000003");
    const form = await readBoundedBookingForm(
      new Request("https://app.test", { method: "POST", body }),
      ["professional_ids", "service_ids", "origins"],
    );
    const parsed = bookingProfileConfig(form);
    expect(parsed.origins).toEqual([
      "https://example.test",
      "https://other.test",
    ]);
    expect(parsed.service_ids).toHaveLength(2);
  });
  it.each([
    "una novela con espacios",
    "https://example.test/pagina",
    "https://example.test?q=1",
    "https://user:password@example.test",
    "javascript:alert(1)",
  ])("rejects invalid website addresses %s", (origin) => {
    const form = settings();
    form.set("name", "Web");
    form.set("origins", origin);
    expect(() => bookingProfileConfig(form)).toThrow();
  });
  it("refuses duplicate website domains after normalization", () => {
    const form = settings();
    form.set("name", "Web");
    form.append("origins", "https://EXAMPLE.test/");
    form.append("origins", "https://example.test");
    expect(() => bookingProfileConfig(form)).toThrow();
  });
  it("keeps duplicate scalar protection on all endpoints", async () => {
    const body = new URLSearchParams([
      ["name", "Web"],
      ["name", "Otra"],
    ]);
    await expect(
      readBoundedBookingForm(
        new Request("https://app.test", { method: "POST", body }),
        ["professional_ids", "service_ids", "origins"],
      ),
    ).rejects.toThrow();
    const selection = new URLSearchParams([
      ["service_ids", "a"],
      ["service_ids", "b"],
    ]);
    await expect(
      readBoundedBookingForm(
        new Request("https://app.test", { method: "POST", body: selection }),
      ),
    ).rejects.toThrow();
  });
});

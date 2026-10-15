import { describe, expect, it } from "vitest";
import { bookingInstallation } from "./booking-installation";

describe("website installation contract", () => {
  const origin = "https://app.cita-suite.workers.dev",
    key = "a".repeat(32);
  it("produces a usable link independently of JavaScript", () => {
    expect(bookingInstallation(origin, key, "link")).toBe(
      `<a href="${origin}/embed/v1/${key}" target="_blank" rel="noopener noreferrer">Reservar turno</a>`,
    );
  });
  it("produces markup understood by the SDK with a progressive fallback", () => {
    const code = bookingInstallation(origin, key, "inline");
    expect(code).toContain(`data-cita-suite-booking="${key}"`);
    expect(code).toContain("data-cita-suite-fallback");
    expect(code).toContain(`/booking/embed-v1.js" defer`);
    expect(code).not.toContain("onload=");
  });
  it.each([
    "javascript:alert(1)",
    "https://example.com/path",
    "https://name:password@example.com",
    "http://example.com",
  ])("refuses an unsafe source %s", (invalid) => {
    expect(() => bookingInstallation(invalid, key, "inline")).toThrow();
  });
  it("refuses invalid keys and only permits loopback explicitly", () => {
    expect(() => bookingInstallation(origin, "bad-key", "inline")).toThrow();
    expect(() =>
      bookingInstallation("http://127.0.0.1:5177", key, "inline"),
    ).toThrow();
    expect(
      bookingInstallation("http://127.0.0.1:5177", key, "inline", true),
    ).toContain("http://127.0.0.1:5177");
  });
});

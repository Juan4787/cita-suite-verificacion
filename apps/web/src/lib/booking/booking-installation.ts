import { normalizeBookingOrigin } from "@cita-suite/shared/booking-integration";

export type BookingInstallMode = "link" | "inline";

const attribute = (value: string) =>
  value.replace(
    /[&"<>]/g,
    (character) =>
      ({
        "&": "&amp;",
        '"': "&quot;",
        "<": "&lt;",
        ">": "&gt;",
      })[character]!,
  );

export function bookingInstallation(
  baseURL: string,
  publicKey: string,
  mode: BookingInstallMode,
  allowLocal = false,
) {
  const origin = normalizeBookingOrigin(baseURL, allowLocal);
  if (
    !origin ||
    !/^[a-f0-9]{32}$/.test(publicKey) ||
    !["link", "inline"].includes(mode)
  ) {
    throw new Error(
      "No pudimos preparar la instalación. Recargá la página y volvé a intentar.",
    );
  }
  const url = `${origin}/embed/v1/${publicKey}`;
  const link = `<a href="${attribute(url)}" target="_blank" rel="noopener noreferrer"${mode === "inline" ? " data-cita-suite-fallback" : ""}>Reservar turno</a>`;
  return mode === "link"
    ? link
    : `<div data-cita-suite-booking="${publicKey}">\n  ${link}\n</div>\n<script src="${attribute(origin)}/booking/embed-v1.js" defer></script>`;
}

import { MAX_BOOKING_DAYS_AHEAD } from "$lib/availability/windows";

export function parseBookingSettings(form: FormData) {
  if (
    !String(form.get("max_booking_days_ahead") ?? "").trim() ||
    !String(form.get("min_booking_notice_minutes") ?? "").trim()
  )
    throw new Error("Elegí el plazo y la anticipación para reservar.");
  const max = Number(form.get("max_booking_days_ahead"));
  const notice = Number(form.get("min_booking_notice_minutes"));
  const policy = String(form.get("cancellation_policy") ?? "").trim();
  if (!Number.isInteger(max) || max < 1 || max > MAX_BOOKING_DAYS_AHEAD)
    throw new Error(`Elegí un plazo para reservar de entre 1 y ${MAX_BOOKING_DAYS_AHEAD} días.`);
  if (!Number.isInteger(notice) || notice < 0 || notice > 10080)
    throw new Error("La anticipación mínima debe estar entre 0 y 7 días.");
  if (policy.length > 2000)
    throw new Error(
      "Las condiciones de cancelación admiten hasta 2000 caracteres.",
    );
  return {
    allow_same_day_booking: form.get("allow_same_day_booking") === "true",
    max_booking_days_ahead: max,
    min_booking_notice_minutes: notice,
    cancellation_policy: policy || null,
  };
}

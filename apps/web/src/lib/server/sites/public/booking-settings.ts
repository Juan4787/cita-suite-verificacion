export function parseBookingSettings(form: FormData) {
  if (
    !String(form.get("max_booking_days_ahead") ?? "").trim() ||
    !String(form.get("min_booking_notice_minutes") ?? "").trim()
  )
    throw new Error("Elegí el plazo y la anticipación para reservar.");
  const max = Number(form.get("max_booking_days_ahead"));
  const notice = Number(form.get("min_booking_notice_minutes"));
  const policy = String(form.get("cancellation_policy") ?? "").trim();
  if (!Number.isInteger(max) || max < 1 || max > 90)
    throw new Error("Elegí un plazo para reservar de entre 1 y 90 días.");
  if (!Number.isInteger(notice) || notice < 0 || notice > 10080)
    throw new Error("La anticipación mínima debe estar entre 0 y 7 días.");
  if (policy.length > 2000)
    throw new Error(
      "Las condiciones de cancelación admiten hasta 2000 caracteres.",
    );
  return {
    max_booking_days_ahead: max,
    min_booking_notice_minutes: notice,
    cancellation_policy: policy || null,
  };
}

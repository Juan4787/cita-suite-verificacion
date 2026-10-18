import { error, fail } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getOdontoContext } from "$lib/server/access/public/odonto-context";
import { bookingInformationEnabled } from "$lib/server/patients/public/booking-information";
import { readBoundedBookingForm } from "$lib/server/platform/form-data";
import { parseBookingIntakeFields } from "@cita-suite/shared/booking-integration";

export async function professionalQuestionContext(event: RequestEvent) {
  const context = await getOdontoContext(event);
  const id = event.params.professionalId;
  if (!id) error(404, "Este profesional no está en tu consultorio.");
  if (!context.business.canManage) {
    if (
      context.business.role !== "professional" ||
      !context.business.access.canUseBusiness
    )
      error(403, "Tu usuario no puede editar estas preguntas.");
    const own = await context.supabase
      .from("professional_users")
      .select("professional_id")
      .eq("business_id", context.business.business.id)
      .eq("user_id", context.userId)
      .eq("professional_id", id)
      .maybeSingle();
    if (own.error)
      error(503, "No pudimos comprobar tu perfil. Volvé a intentar.");
    if (!own.data)
      error(403, "Sólo podés editar las preguntas de tu propio perfil.");
  }
  const person = await context.supabase
    .from("professionals")
    .select("id,name")
    .eq("business_id", context.business.business.id)
    .eq("id", id)
    .maybeSingle();
  if (person.error)
    error(503, "No pudimos cargar el perfil. Volvé a intentar.");
  if (!person.data) error(404, "Este profesional no está en tu consultorio.");
  return { ...context, professional: person.data };
}

export async function loadProfessionalQuestions(event: RequestEvent) {
  const context = await professionalQuestionContext(event);
  const enabled = bookingInformationEnabled();
  const row = enabled
    ? await context.supabase
        .from("professional_booking_forms")
        .select("revision,fields")
        .eq("business_id", context.business.business.id)
        .eq("professional_id", context.professional.id)
        .maybeSingle()
    : { data: null, error: null };
  if (row.error)
    error(503, "No pudimos cargar las preguntas. Volvé a intentar.");
  return {
    professional: context.professional,
    configuration: row.data
      ? { revision: row.data.revision, fields: parseBookingIntakeFields(row.data.fields) }
      : null,
    canManage: context.business.canManage,
    enabled,
  };
}

export async function saveProfessionalQuestions(event: RequestEvent) {
  const context = await professionalQuestionContext(event);
  if (!bookingInformationEnabled())
    return fail(503, {
      message: "Las preguntas de reserva todavía no están habilitadas.",
    });
  try {
    const form = await readBoundedBookingForm(event.request);
    const fields = parseBookingIntakeFields(
      JSON.parse(String(form.get("fields") ?? "[]")),
    );
    const revision = Number(form.get("revision"));
    if (!Number.isSafeInteger(revision) || revision < 0)
      return fail(400, { message: "Recargá las preguntas antes de guardar." });
    const { error: cause } = await context.supabase.rpc(
      "save_professional_booking_form",
      {
        p_business_id: context.business.business.id,
        p_professional_id: context.professional.id,
        p_expected_revision: revision,
        p_fields: fields,
      },
    );
    if (cause)
      return fail(
        cause.message.includes("BOOKING_INTEGRATION_CHANGED") ? 409 : 400,
        {
          message: cause.message.includes("BOOKING_INTEGRATION_CHANGED")
            ? "Las preguntas cambiaron mientras las editabas. Recargá la página y revisá los cambios."
            : "Revisá las preguntas y sus opciones antes de guardar.",
        },
      );
    return { formSaved: true, message: "Preguntas guardadas." };
  } catch {
    return fail(400, {
      message:
        "Revisá las preguntas: cada dato de la ficha puede aparecer una sola vez.",
    });
  }
}

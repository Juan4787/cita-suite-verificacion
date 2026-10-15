import { fail, error, redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { getOdontoContext } from "$lib/server/odonto-context";
import { createSupabaseAdminClient } from "$lib/server/supabase";
import { bookingInformationEnabled } from "$lib/server/booking-information";
import { readBoundedBookingForm } from "$lib/server/public-booking-page";
import { parseBookingSettings } from "$lib/server/booking-settings";
import type { PageServerLoad, Actions } from "./$types";
export const load: PageServerLoad = async (event) => {
  const context = await getOdontoContext(event);
  if (
    event.url.searchParams.has("perfil") ||
    event.url.searchParams.has("nuevo")
  )
    redirect(
      303,
      "/odonto/configuracion/reserva-online/webs" + event.url.search,
    );
  if (!context.business.canManage) {
    if (context.business.role === "professional")
      redirect(303, "/odonto/mis-preguntas");
    error(403, "Tu usuario no puede administrar las reservas online.");
  }
  const count = bookingInformationEnabled()
    ? await context.supabase
        .from("booking_integrations")
        .select("id", { count: "exact", head: true })
        .eq("business_id", context.business.business.id)
        .neq("allowed_origins", "{}")
    : { count: 0, error: null };
  if (count.error)
    error(503, "No pudimos cargar las reservas. Volvé a intentar.");
  return {
    business: context.business.business,
    enabled: bookingInformationEnabled(),
    connectedSites: count.count ?? 0,
    baseURL: env.PUBLIC_SITE_URL || event.url.origin,
    canBook: context.business.access.allowedCapabilities.canUsePublicBooking,
  };
};
async function saveSettings(
  event: Parameters<NonNullable<Actions[string]>>[0],
  toggle: boolean,
) {
  const context = await getOdontoContext(event);
  if (!context.business.canManage)
    return fail(403, {
      message: "Tu usuario no puede cambiar las reservas del consultorio.",
    });
  try {
    const form = await readBoundedBookingForm(event.request);
    let patch: Record<string, unknown>;
    if (toggle) {
      const requested = form.get("enabled");
      if (requested !== "true" && requested !== "false")
        return fail(400, {
          message: "Elegí si querés recibir nuevas reservas.",
        });
      if (requested === "true" && !context.business.business.address)
        return fail(400, {
          message:
            "Cargá la dirección en Datos del consultorio antes de activar las reservas.",
        });
      if (
        requested === "true" &&
        (!context.business.business.is_active ||
          !context.business.access.allowedCapabilities.canUsePublicBooking)
      )
        return fail(403, {
          message:
            "El consultorio necesita acceso activo para recibir reservas online.",
        });
      patch = { public_booking_enabled: requested === "true" };
    } else patch = parseBookingSettings(form);
    const expected = String(form.get("revision") ?? "");
    if (!expected)
      return fail(409, { message: "Recargá la página antes de guardar." });
    let client = context.supabase;
    if (context.business.assistance) {
      const grant = await client.rpc("user_has_active_account_assistance", {
        target_business_id: context.business.business.id,
      });
      if (grant.error || grant.data !== true)
        return fail(403, {
          message:
            "La autorización de ayuda venció. Volvé a abrir el consultorio.",
        });
      client = await createSupabaseAdminClient("odonto", event.fetch);
    }
    const result = await client
      .from("businesses")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", context.business.business.id)
      .eq("updated_at", expected)
      .select("id")
      .maybeSingle();
    if (result.error)
      return fail(400, {
        message:
          "No pudimos guardar las reservas. Revisá los valores y volvé a intentar.",
      });
    if (!result.data)
      return fail(409, {
        message:
          "La configuración cambió mientras la editabas. Recargá la página antes de guardar.",
      });
    return {
      saved: true,
      message: toggle
        ? patch.public_booking_enabled
          ? "Reservas activadas."
          : "Reservas pausadas. Los turnos existentes se conservan."
        : "Reglas de reserva guardadas.",
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    return fail(400, {
      message: /^(Elegí|La anticipación|Las condiciones)/.test(message)
        ? message
        : "Revisá los campos antes de guardar.",
    });
  }
}
export const actions: Actions = {
  save_rules: (event) => saveSettings(event, false),
  set_enabled: (event) => saveSettings(event, true),
};

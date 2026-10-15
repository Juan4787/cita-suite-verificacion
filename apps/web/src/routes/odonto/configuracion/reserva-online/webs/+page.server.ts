import { fail, error, redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { getOdontoContext } from "$lib/server/odonto-context";
import { bookingInformationEnabled } from "$lib/server/booking-information";
import { bookingProfileConfig } from "$lib/server/booking-profile-config";
import { readBoundedBookingForm } from "$lib/server/public-booking-page";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async (event) => {
  const context = await getOdontoContext(event);
  if (!context.business.canManage)
    error(
      403,
      "Sólo quien administra el consultorio puede configurar sitios web.",
    );
  const enabled = bookingInformationEnabled();
  const empty = {
    enabled,
    canManage: true,
    profiles: [],
    professionals: [],
    services: [],
    assignments: [],
    selectedId: "",
    baseURL: env.PUBLIC_SITE_URL || event.url.origin,
    isNew: false,
  };
  if (!enabled) return empty;
  const id = context.business.business.id;
  const results = await Promise.all([
    context.supabase
      .from("booking_integrations")
      .select("*")
      .eq("business_id", id)
      .order("name")
      .limit(20),
    context.supabase
      .from("professionals")
      .select("id,name,is_public,is_active")
      .eq("business_id", id)
      .order("name"),
    context.supabase
      .from("services")
      .select("id,name,is_public,is_active,duration_minutes,price_label")
      .eq("business_id", id)
      .order("name"),
    context.supabase
      .from("professional_services")
      .select("professional_id,service_id")
      .eq("business_id", id),
  ]);
  if (results.some((row) => row.error))
    error(503, "No pudimos cargar los sitios web. Volvé a intentar.");
  const selectedId = event.url.searchParams.get("perfil") ?? "";
  if (
    selectedId &&
    !(results[0].data ?? []).some((row) => row.id === selectedId)
  )
    error(404, "Este sitio no está registrado en tu consultorio.");
  return {
    ...empty,
    profiles: results[0].data ?? [],
    professionals: results[1].data ?? [],
    services: results[2].data ?? [],
    assignments: results[3].data ?? [],
    selectedId,
    isNew: event.url.searchParams.get("nuevo") === "1",
  };
};
export const actions: Actions = {
  save: async (event) => {
    if (!bookingInformationEnabled())
      return fail(503, {
        message: "La configuración de reservas todavía no está habilitada.",
      });
    const context = await getOdontoContext(event);
    if (!context.business.canManage)
      return fail(403, {
        message: "Tu usuario no puede administrar los enlaces de reserva.",
      });
    try {
      const form = await readBoundedBookingForm(event.request, [
        "professional_ids",
        "service_ids",
        "origins",
      ]);
      const config = bookingProfileConfig(form);
      if (form.get('scope') === 'selected' && !config.professional_ids.length)
        return fail(400, {message:'Elegí al menos un profesional para esta web.'});
      if (form.get('limit_services') === 'true' && !config.service_ids.length)
        return fail(400, {message:'Elegí al menos un servicio para esta web.'});
      const { data, error: cause } = await context.supabase.rpc(
        "save_booking_integration",
        {
          p_business_id: context.business.business.id,
          p_integration_id: String(form.get("id") ?? "") || null,
          p_expected_revision: Number(form.get("revision")) || null,
          p_config: config,
        },
      );
      if (cause) {
        const message = cause.message.includes("BOOKING_CONFIG_INCOMPLETE")
          ? "Antes de activar, elegí profesionales y prestaciones públicas, configurá sus horarios y habilitá la reserva del consultorio."
          : cause.message.includes("BOOKING_INTEGRATION_CHANGED")
            ? "Otro usuario actualizó este enlace. Recargá la página y revisá los cambios antes de guardar."
            : "No pudimos guardar el enlace. Revisá su configuración y volvé a intentar.";
        return fail(400, { message });
      }
      throw redirect(303, `?perfil=${data.id}&instalar=1&guardado=1`);
    } catch (cause) {
      if ((cause as any)?.status === 303) throw cause;
      return fail(400, {
        message:
          "Revisá la dirección web y las opciones de la agenda antes de guardar.",
      });
    }
  },
};

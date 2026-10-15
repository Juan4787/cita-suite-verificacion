import { env } from "$env/dynamic/private";
import { getOdontoContext } from "./odonto-context";
import { bookingInformationEnabled } from "./booking-information";
import { readBoundedBookingForm } from "./public-booking-page";
import { monthForTimezone } from "$lib/booking/pricing";
import { error, fail } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
async function contextForPrice(event: RequestEvent) {
  const context = await getOdontoContext(event);
  const id = String(event.params.professionalId ?? "");
  if (!context.business.canManage) {
    const { data, error: cause } = await context.supabase
      .from("professional_users")
      .select("professional_id")
      .eq("business_id", context.business.business.id)
      .eq("user_id", context.userId)
      .eq("professional_id", id)
      .maybeSingle();
    if (cause || !data || context.business.role !== "professional")
      error(403, "Tu usuario no puede configurar estos aranceles.");
  }
  return context;
}
export async function loadPricePolicyEditor(event: RequestEvent) {
  const context = await contextForPrice(event);
  const businessId = context.business.business.id;
  const professionalId = String(event.params.professionalId);
  const [
    { data: professional, error: proError },
    { data: assignments, error: assignmentError },
    { data: policies, error: priceError },
  ] = await Promise.all([
    context.supabase
      .from("professionals")
      .select("id,name")
      .eq("business_id", businessId)
      .eq("id", professionalId)
      .single(),
    context.supabase
      .from("professional_services")
      .select("services(id,name)")
      .eq("business_id", businessId)
      .or(`professional_id.eq.${professionalId},professional_id.is.null`),
    (context.supabase as any)
      .from("service_price_policies")
      .select("*,service_price_monthly_adjustments(month,kind,percentage)")
      .eq("business_id", businessId)
      .or(`professional_id.eq.${professionalId},professional_id.is.null`),
  ]);
  if (proError || assignmentError || priceError)
    error(
      503,
      "No pudimos cargar las prestaciones y aranceles. Volvé a intentar.",
    );
  return {
    professional,
    services: (assignments ?? []).flatMap((row) =>
      Array.isArray(row.services)
        ? row.services
        : row.services
          ? [row.services]
          : [],
    ),
    policies: policies ?? [],
    currentMonth: monthForTimezone(
      new Date(),
      context.business.business.timezone,
    ),
    canConfigureShared:context.business.canManage,
    canEdit:
      context.business.access.canUseBusiness && bookingInformationEnabled(),
  };
}
export async function savePricePolicy(event: RequestEvent) {
  if (env.DEMO_MODE === "true")
    return fail(400, { message: "La demo no modifica aranceles reales." });
  const context = await contextForPrice(event);
  if (!bookingInformationEnabled() || !context.business.access.canUseBusiness)
    return fail(403, {
      message:
        "La configuración de aranceles todavía no está habilitada para tu consultorio.",
    });
  try {
    const form = await readBoundedBookingForm(event.request);
    const scope=String(form.get("price_scope")??"professional");
    if(!["professional","service_default"].includes(scope))return fail(400,{message:"Elegí qué tarifa querés configurar."});
    if(scope==="service_default"&&!context.business.canManage)return fail(403,{message:"Sólo el dueño o un administrador puede configurar una tarifa compartida."});
    const raw = String(form.get("price_configuration") ?? "");
    if (raw.length > 32000) throw new Error("invalid");
    const { error: cause } = await context.supabase.rpc(
      "save_service_price_policy" as never,
      {
        p_business_id: context.business.business.id,
        p_service_id: String(form.get("price_service_id") ?? ""),
        p_professional_id: scope==="service_default"?null:String(event.params.professionalId),
        p_expected_revision: Number(form.get("price_revision")),
        p_configuration: JSON.parse(raw),
      } as never,
    );
    if (cause)
      return fail(400, {
        message: cause.message.includes("PRICE_POLICY_CHANGED")
          ? "Otra persona cambió estos aranceles. Recargá y revisá los valores antes de guardar."
          : "Revisá importe, meses y porcentajes. No se guardó ningún cambio.",
      });
    return {
      saved: true,
      message: "Los aranceles y ajustes mensuales quedaron guardados.",
    };
  } catch {
    return fail(400, {
      message: "Revisá los aranceles y cambios mensuales antes de guardar.",
    });
  }
}

import { env } from "$env/dynamic/private";
import { createSupabaseAdminClient } from "$lib/server/supabase";
import { getOdontoContext } from "$lib/server/odonto-context";
import { readBoundedBookingForm } from "$lib/server/public-booking-page";
import { error, fail, type RequestEvent, type Actions } from "@sveltejs/kit";
export const legacyPublicPracticeActions: Actions = {
  cleanup: async (event) => {
    if (env.DEMO_MODE === "true")
      return fail(400, { message: "No disponible en modo demo." });
    const context = await getOdontoContext(event);
    if (!context.business.canManage)
      return fail(403, {
        message: "Tu usuario no puede limpiar cargas abandonadas.",
      });
    const admin = await createSupabaseAdminClient("odonto", event.fetch);
    const { data, error: cause } = await admin.rpc(
      "claim_expired_clinical_uploads" as never,
      {
        p_business_id: context.business.business.id,
        p_actor_id: context.userId,
      } as never,
    );
    if (cause)
      return fail(400, {
        message: "No pudimos revisar las cargas abandonadas. Probá nuevamente.",
      });
    let removed = 0;
    for (const item of (data ?? []) as any[]) {
      const { error: removeError } = await admin.storage
        .from(item.bucket)
        .remove(item.paths);
      if (removeError)
        return fail(503, {
          message:
            "No pudimos terminar la limpieza. Los documentos confirmados se conservan; podés volver a intentar.",
        });
      removed++;
    }
    return {
      saved: true,
      message: removed
        ? "Se limpiaron cargas abandonadas. Los documentos guardados y la papelera se conservaron."
        : "No hay cargas abandonadas que puedan limpiarse.",
    };
  },
  save: async (event) => {
    if (env.DEMO_MODE === "true")
      return fail(400, { message: "No disponible en modo demo." });
    const context = await getOdontoContext(event);
    if (!context.business.canManage)
      return fail(403, {
        message: "Tu usuario no puede cambiar esta configuración.",
      });
    try {
      const form = await readBoundedBookingForm(event.request);
      const settings = {
        patient_documents_enabled:
          form.get("patient_documents_enabled") === "true",
        public_contact_enabled: form.get("public_contact_enabled") === "true",
        whatsapp_contact_enabled:
          form.get("whatsapp_contact_enabled") === "true",
        whatsapp_phone: String(form.get("whatsapp_phone") ?? "")
          .trim()
          .replace(/[\s().-]/g, ""),
        whatsapp_message: String(form.get("whatsapp_message") ?? "").trim(),
      };
      const { error: cause } = await context.supabase.rpc(
        "save_public_practice_settings" as never,
        {
          p_business_id: context.business.business.id,
          p_settings: settings,
          p_expected_updated_at: String(form.get("settings_updated_at") ?? ""),
        } as never,
      );
      if (cause?.message.includes("CARE_CONFIGURATION_CHANGED"))
        return fail(409, {
          message:
            "La configuración cambió en otra pestaña. Recargá antes de guardar.",
        });
      if (cause)
        return fail(400, {
          message:
            "Revisá el teléfono con código de país y el texto de contacto. No se guardó ningún cambio.",
        });
      return {
        saved: true,
        message: "La configuración del consultorio quedó guardada.",
      };
    } catch {
      return fail(400, {
        message: "Revisá la configuración antes de guardar.",
      });
    }
  },
  instructions: async (event) => {
    if (env.DEMO_MODE === "true")
      return fail(400, { message: "No disponible en modo demo." });
    const context = await getOdontoContext(event);
    if (!context.business.canManage)
      return fail(403, {
        message: "Tu usuario no puede cambiar las indicaciones.",
      });
    const form = await readBoundedBookingForm(event.request);
    const { error: cause } = await context.supabase.rpc(
      "save_service_patient_instructions" as never,
      {
        p_business_id: context.business.business.id,
        p_service_id: String(form.get("service_id") ?? ""),
        p_instructions: String(form.get("instructions") ?? ""),
        p_public_description: String(form.get("public_description") ?? ""),
        p_expected_updated_at: String(form.get("service_updated_at") ?? ""),
      } as never,
    );
    if (cause?.message.includes("CARE_CONFIGURATION_CHANGED"))
      return fail(409, {
        message:
          "La prestación cambió en otra pestaña. Recargá antes de guardar.",
      });
    if (cause)
      return fail(400, {
        message: "Revisá la prestación y acortá los textos demasiado extensos.",
      });
    return {
      saved: true,
      message:
        "Las indicaciones se aplicarán a los nuevos turnos de esta prestación.",
    };
  },
};

export async function loadPublicPracticeSettings(
  event: RequestEvent,
  documents: boolean,
) {
  const context = await getOdontoContext(event);
  if (!context.business.canManage)
    error(403, "Tu usuario no puede cambiar la configuración del consultorio.");
  const row = await context.supabase
    .from("businesses")
    .select(
      "id,name,updated_at,patient_documents_enabled,public_contact_enabled,whatsapp_contact_enabled,whatsapp_phone,whatsapp_message",
    )
    .eq("id", context.business.business.id)
    .single();
  if (row.error || !row.data)
    error(503, "No pudimos cargar esta configuración. Volvé a intentar.");
  let budget: any = null;
  if (documents) {
    const response = await context.supabase.rpc("get_clinical_storage_budget", {
      p_business_id: context.business.business.id,
    });
    if (response.error)
      error(
        503,
        "No pudimos consultar el espacio para archivos. Volvé a intentar.",
      );
    budget = response.data;
  }
  return { settings: row.data, budget };
}

export async function savePublicPracticePart(
  event: RequestEvent,
  part: "contact" | "documents",
) {
  if (env.DEMO_MODE === "true")
    return fail(400, { message: "La demo no cambia configuraciones reales." });
  const context = await getOdontoContext(event);
  if (!context.business.canManage)
    return fail(403, {
      message: "Tu usuario no puede cambiar esta configuración.",
    });
  try {
    const form = await readBoundedBookingForm(event.request);
    const current = await context.supabase
      .from("businesses")
      .select(
        "patient_documents_enabled,public_contact_enabled,whatsapp_contact_enabled,whatsapp_phone,whatsapp_message",
      )
      .eq("id", context.business.business.id)
      .single();
    if (current.error || !current.data)
      return fail(503, {
        message: "No pudimos cargar la configuración actual. Volvé a intentar.",
      });
    const settings = { ...current.data };
    if (part === "documents")
      settings.patient_documents_enabled =
        form.get("patient_documents_enabled") === "true";
    else {
      settings.public_contact_enabled =
        form.get("public_contact_enabled") === "true";
      settings.whatsapp_contact_enabled =
        form.get("whatsapp_contact_enabled") === "true";
      settings.whatsapp_phone =
        String(form.get("whatsapp_phone") ?? "")
          .trim()
          .replace(/[\s().-]/g, "") || null;
      settings.whatsapp_message =
        String(form.get("whatsapp_message") ?? "").trim() || null;
    }
    const result = await context.supabase.rpc("save_public_practice_settings", {
      p_business_id: context.business.business.id,
      p_settings: settings,
      p_expected_updated_at: String(form.get("settings_updated_at") ?? ""),
    });
    if (result.error)
      return fail(
        result.error.message.includes("CARE_CONFIGURATION_CHANGED") ? 409 : 400,
        {
          message: result.error.message.includes("CARE_CONFIGURATION_CHANGED")
            ? "La configuración cambió. Recargá antes de guardar."
            : "Revisá los campos. No se guardó ningún cambio.",
        },
      );
    return {
      saved: true,
      message:
        part === "documents"
          ? "Permisos de archivos guardados."
          : "Contacto web guardado.",
    };
  } catch {
    return fail(400, { message: "Revisá los campos antes de guardar." });
  }
}

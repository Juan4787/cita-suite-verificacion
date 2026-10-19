import { InvalidDataContractError, readBoolean, readFiniteNumber, readRecord } from '$lib/contracts/json';
import { env } from "$env/dynamic/private";
import { createSupabaseAdminClient } from "$lib/server/platform/supabase";
import { readExpiredClinicalUploads, removeExpiredClinicalUploads } from "$lib/server/patients/public/clinical-files";
import { getOdontoContext } from "$lib/server/access/public/odonto-context";
import { readBoundedBookingForm } from "$lib/server/platform/form-data";
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
      "claim_expired_clinical_uploads",
      {
        p_business_id: context.business.business.id,
        p_actor_id: context.userId,
      },
    );
    if (cause)
      return fail(400, {
        message: "No pudimos revisar las cargas abandonadas. Probá nuevamente.",
      });
    const uploads = readExpiredClinicalUploads(data);
    try {
      await removeExpiredClinicalUploads(admin, uploads);
    } catch {
      return fail(503, {
        message:
          "No pudimos terminar la limpieza. Los documentos confirmados se conservan; podés volver a intentar.",
      });
    }
    return {
      saved: true,
      message: uploads.length
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
        "save_public_practice_settings",
        {
          p_business_id: context.business.business.id,
          p_settings: settings,
          p_expected_updated_at: String(form.get("settings_updated_at") ?? ""),
        },
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
      "save_service_patient_instructions",
      {
        p_business_id: context.business.business.id,
        p_service_id: String(form.get("service_id") ?? ""),
        p_instructions: String(form.get("instructions") ?? ""),
        p_public_description: String(form.get("public_description") ?? ""),
        p_expected_updated_at: String(form.get("service_updated_at") ?? ""),
      },
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

type PracticeSettings = import('$lib/types/database').CitaRow<'businesses'>;
type LoadedPracticeSettings = Pick<PracticeSettings, 'id' | 'name' | 'updated_at' | 'patient_documents_enabled' | 'public_contact_enabled' | 'whatsapp_contact_enabled' | 'whatsapp_phone' | 'whatsapp_message'>;
type StorageBudget = ReturnType<typeof parseStorageBudget>;
export function loadPublicPracticeSettings(event: RequestEvent, documents: true): Promise<{ settings: LoadedPracticeSettings; budget: StorageBudget }>;
export function loadPublicPracticeSettings(event: RequestEvent, documents: boolean): Promise<{ settings: LoadedPracticeSettings; budget: StorageBudget | null }>;
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
  let budget: ReturnType<typeof parseStorageBudget> | null = null;
  if (documents) {
    const response = await context.supabase.rpc("get_clinical_storage_budget", {
      p_business_id: context.business.business.id,
    });
    if (response.error)
      error(
        503,
        "No pudimos consultar el espacio para archivos. Volvé a intentar.",
      );
    budget = parseStorageBudget(response.data);
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
    if (result.error?.message.includes('CLINICAL_DOCUMENTS_DISABLED'))
      return fail(409, { message: 'La carga de documentos está pausada. Los archivos guardados se conservan.' });
    if (result.error?.message.includes('CLINICAL_STORAGE_ACCOUNT_MISSING'))
      return fail(503, { message: 'No pudimos consultar el espacio del consultorio. Probá nuevamente en unos minutos.' });
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


export function parseStorageBudget(value: unknown) {
  const row = readRecord(value, 'clinicalStorageBudget');
  const bytes = (key: string) => {
    const value = readFiniteNumber(row[key], 'clinicalStorageBudget.' + key);
    if (!Number.isSafeInteger(value) || value < 0) throw new InvalidDataContractError('clinicalStorageBudget.' + key);
    return value;
  };
  const percentage = readFiniteNumber(row.percentage, 'clinicalStorageBudget.percentage');
  if (percentage < 0) throw new InvalidDataContractError('clinicalStorageBudget.percentage');
  const account = readRecord(row.business, 'clinicalStorageBudget.business');
  const accountBytes = (key: string) => {
    const value = readFiniteNumber(account[key], 'clinicalStorageBudget.business.' + key);
    if (!Number.isSafeInteger(value) || value < 0 || (key === 'max_bytes' && value === 0))
      throw new InvalidDataContractError('clinicalStorageBudget.business.' + key);
    return value;
  };
  if (bytes('max_bytes') === 0) throw new InvalidDataContractError('clinicalStorageBudget.max_bytes');
  return { used_bytes: bytes('used_bytes'), reserved_bytes: bytes('reserved_bytes'), max_bytes: bytes('max_bytes'),
    database_bytes: bytes('database_bytes'), monthly_authorized_download_bytes: bytes('monthly_authorized_download_bytes'), percentage,
    uploads_enabled: readBoolean(row.uploads_enabled, 'clinicalStorageBudget.uploads_enabled'),
    business: { used_bytes: accountBytes('used_bytes'), reserved_bytes: accountBytes('reserved_bytes'), max_bytes: accountBytes('max_bytes'),
      uploads_enabled: readBoolean(account.uploads_enabled, 'clinicalStorageBudget.business.uploads_enabled') } };
}

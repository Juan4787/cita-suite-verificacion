import { beforeEach, describe, it, expect, vi } from "vitest";
const getContext = vi.hoisted(() => vi.fn());
vi.mock("./odonto-context", () => ({ getOdontoContext: getContext }));
vi.mock("$env/dynamic/private", () => ({ env: { DEMO_MODE: "false" } }));
import {
  savePublicPracticePart,
  loadPublicPracticeSettings,
} from "./public-practice-settings";
let client: any;
const current = {
  patient_documents_enabled: true,
  public_contact_enabled: true,
  whatsapp_contact_enabled: true,
  whatsapp_phone: "+5491112345678",
  whatsapp_message: "Consulta general",
};
function setup(canManage = true) {
  const builder: any = {
    select: () => builder,
    eq: vi.fn(() => builder),
    single: async () => ({ data: { ...current }, error: null }),
  };
  client = {
    from: vi.fn(() => builder),
    rpc: vi.fn().mockResolvedValue({ error: null, data: { used_bytes: 0 } }),
  };
  getContext.mockResolvedValue({
    supabase: client,
    business: { business: { id: "practice" }, canManage },
    userId: "owner",
  });
}
const event = (data: Record<string, string> = {}) =>
  ({
    request: new Request("https://app.test", {
      method: "POST",
      body: new URLSearchParams({ settings_updated_at: "version", ...data }),
    }),
  }) as any;
beforeEach(() => setup());
describe("public practice tasks have independent state", () => {
  it("documents can change upload permission without changing contact settings", async () => {
    await savePublicPracticePart(
      event({ public_contact_enabled: "false", whatsapp_phone: "forged" }),
      "documents",
    );
    expect(client.rpc).toHaveBeenCalledWith(
      "save_public_practice_settings",
      expect.objectContaining({
        p_business_id: "practice",
        p_settings: { ...current, patient_documents_enabled: false },
        p_expected_updated_at: "version",
      }),
    );
  });
  it("contact cannot overwrite document permission, even with a forged document field", async () => {
    await savePublicPracticePart(
      event({
        patient_documents_enabled: "false",
        public_contact_enabled: "true",
        whatsapp_contact_enabled: "true",
        whatsapp_phone: "+54 9 (11) 1234-5678",
        whatsapp_message: " Consulta general ",
      }),
      "contact",
    );
    expect(client.rpc).toHaveBeenCalledWith(
      "save_public_practice_settings",
      expect.objectContaining({ p_settings: current }),
    );
  });
  it("does not query storage or services when editing contact", async () => {
    await loadPublicPracticeSettings(event(), false);
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith("businesses");
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("loads the budget only for the document task", async () => {
    await loadPublicPracticeSettings(event(), true);
    expect(client.rpc).toHaveBeenCalledWith("get_clinical_storage_budget", {
      p_business_id: "practice",
    });
  });
  it("protects concurrent edits with the existing settings revision", async () => {
    client.rpc.mockResolvedValue({
      error: { message: "CARE_CONFIGURATION_CHANGED" },
    });
    expect(await savePublicPracticePart(event(), "documents")).toMatchObject({
      status: 409,
    });
  });
  it("denies non-managers before reading or writing settings", async () => {
    setup(false);
    expect(await savePublicPracticePart(event(), "contact")).toMatchObject({
      status: 403,
    });
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

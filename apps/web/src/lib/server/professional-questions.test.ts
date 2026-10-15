import { beforeEach, describe, it, expect, vi } from "vitest";
const getContext = vi.hoisted(() => vi.fn());
vi.mock("./odonto-context", () => ({ getOdontoContext: getContext }));
vi.mock("./booking-information", () => ({
  bookingInformationEnabled: () => true,
}));
import {
  loadProfessionalQuestions,
  saveProfessionalQuestions,
} from "./professional-questions";
const personId = "10000000-0000-4000-8000-000000000001";
let client: any;
let queries: Array<{ table: string; filters: Array<[string, unknown]> }>;
function mockContext(role = "professional", own = true, person = true) {
  queries = [];
  const from = vi.fn((table: string) => {
    const query = { table, filters: [] as Array<[string, unknown]> };
    queries.push(query);
    const builder: any = {
      select: () => builder,
      eq: (key: string, value: unknown) => {
        query.filters.push([key, value]);
        return builder;
      },
      maybeSingle: async () => ({
        error: null,
        data:
          table === "professional_users"
            ? own
              ? { professional_id: personId }
              : null
            : table === "professionals"
              ? person
                ? { id: personId, name: "Profesional sintético" }
                : null
              : { revision: 2, fields: [] },
      }),
    };
    return builder;
  });
  client = { from, rpc: vi.fn().mockResolvedValue({ error: null }) };
  getContext.mockResolvedValue({
    supabase: client,
    userId: "user",
    business: {
      business: { id: "practice" },
      canManage: role === "owner",
      role,
      access: { canUseBusiness: true },
    },
  });
}
function event(body = new URLSearchParams({ revision: "2", fields: "[]" })) {
  return {
    params: { professionalId: personId },
    request: new Request("https://app.test", { method: "POST", body }),
  } as any;
}
beforeEach(() => mockContext());
describe("professional questions stay in their own profile", () => {
  it("loads only a linked professional in the current practice", async () => {
    const loaded = await loadProfessionalQuestions(event());
    expect(loaded.professional.id).toBe(personId);
    expect(queries[0].filters).toEqual([
      ["business_id", "practice"],
      ["user_id", "user"],
      ["professional_id", personId],
    ]);
    expect(queries[1].filters).toContainEqual(["business_id", "practice"]);
  });
  it("ignores a forged professional id in the submitted form", async () => {
    const body = new URLSearchParams({
      professional_id: "someone-else",
      revision: "2",
      fields: "[]",
    });
    expect(await saveProfessionalQuestions(event(body))).toMatchObject({
      formSaved: true,
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "save_professional_booking_form",
      expect.objectContaining({
        p_business_id: "practice",
        p_professional_id: personId,
      }),
    );
  });
  it.each(["load", "save"])(
    "denies an unrelated professional before %s",
    async (operation) => {
      mockContext("professional", false);
      await expect(
        operation === "load"
          ? loadProfessionalQuestions(event())
          : saveProfessionalQuestions(event()),
      ).rejects.toMatchObject({ status: 403 });
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );
  it("denies a read-only role", async () => {
    mockContext("viewer");
    await expect(loadProfessionalQuestions(event())).rejects.toMatchObject({
      status: 403,
    });
    expect(client.from).not.toHaveBeenCalled();
  });
  it("allows a manager to edit a professional of the current practice", async () => {
    mockContext("owner");
    await saveProfessionalQuestions(event());
    expect(queries[0].table).toBe("professionals");
    expect(queries[0].filters).toContainEqual(["business_id", "practice"]);
  });
  it("refuses a profile outside the current practice", async () => {
    mockContext("owner", true, false);
    await expect(saveProfessionalQuestions(event())).rejects.toMatchObject({
      status: 404,
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("returns a conflict without overwriting a newer questionnaire", async () => {
    client.rpc.mockResolvedValue({
      error: { message: "BOOKING_INTEGRATION_CHANGED" },
    });
    const result = await saveProfessionalQuestions(event());
    expect(result).toMatchObject({ status: 409 });
  });
});

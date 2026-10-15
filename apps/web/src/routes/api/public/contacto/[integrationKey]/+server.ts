import { json, error } from "@sveltejs/kit";
import { createSupabaseAdminClient } from "$lib/server/supabase";
import { hashRateLimitSubject } from "$lib/server/rate-limits";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = async (event) => {
  event.setHeaders({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (!/^[a-f0-9]{32}$/.test(event.params.integrationKey))
    error(404, "Este contacto todavía no está disponible.");
  const admin = await createSupabaseAdminClient("odonto", event.fetch);
  const { data: allowed, error: limited } = await admin.rpc(
    "consume_booking_integration_read_limit",
    { p_subject_hash: hashRateLimitSubject(event.getClientAddress()) },
  );
  if (limited || allowed !== true)
    error(429, "Esperá un momento antes de consultar el contacto nuevamente.");
  const { data, error: cause } = await admin.rpc(
    "get_public_practice_contact" as never,
    { p_key: event.params.integrationKey } as never,
  );
  if (cause || !data)
    error(404, "El contacto del consultorio todavía no está habilitado.");
  const result = data as any;
  const origin = event.request.headers.get("origin");
  if (origin && !result.allowed_origins?.includes(origin))
    error(403, "Este sitio no está habilitado para consultar el contacto.");
  return json(
    { contact: result.contact },
    {
      headers: {
        ...(origin ? { "access-control-allow-origin": origin } : {}),
        vary: "Origin",
        "cache-control": "public, max-age=60, s-maxage=60",
      },
    },
  );
};

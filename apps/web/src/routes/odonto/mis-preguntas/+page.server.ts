import { error, redirect } from "@sveltejs/kit";
import { getOdontoContext } from "$lib/server/access/public/odonto-context";
import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = async (event) => {
  const context = await getOdontoContext(event);
  if (context.business.canManage)
    redirect(303, "/odonto/configuracion/usuarios");
  if (
    context.business.role !== "professional" ||
    !context.business.access.canUseBusiness
  )
    error(403, "Tu usuario no puede configurar estas preguntas.");
  const own = await context.supabase
    .from("professional_users")
    .select("professional_id,professionals(id,name)")
    .eq("business_id", context.business.business.id)
    .eq("user_id", context.userId);
  if (own.error) error(503, "No pudimos cargar tu perfil. Volvé a intentar.");
  const professionals = (own.data ?? [])
    .map((row) =>
      Array.isArray(row.professionals)
        ? row.professionals[0]
        : row.professionals,
    )
    .filter((professional) => professional !== null && professional !== undefined);
  if (professionals.length === 1)
    redirect(303, `/odonto/profesionales/${professionals[0].id}/preguntas`);
  return { professionals };
};

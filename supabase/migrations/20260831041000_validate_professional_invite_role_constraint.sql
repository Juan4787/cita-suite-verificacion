-- La restricción se creó NOT VALID para permitir la migración histórica.
-- Las filas existentes ya fueron auditadas; desde este punto debe quedar
-- validada para que también cubra todo el contenido preexistente.
alter table public.business_user_invites
	validate constraint business_user_invites_professional_role_supported_chk;

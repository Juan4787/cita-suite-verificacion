-- Estas funciones pertenecen a flujos históricos que ya no usa la aplicación.
-- No deben poder consultarse desde una sesión de consultorio:
-- * accept_pending_business_invites_for_user podía aceptar una invitación para
--   otro usuario si se conocían su correo e ID;
-- * business_commercial_status y user_is_active_owner permitían sondear el
--   estado comercial o la relación de dueño de cualquier consultorio.
-- Se conservan las funciones para no romper una eventual restauración histórica,
-- pero se cierra su superficie pública. El DO condicional permite reconstruir
-- una base limpia aunque esos objetos heredados no formen parte de las
-- migraciones versionadas.

do $$
begin
	if to_regprocedure('public.accept_pending_business_invites_for_user(text, uuid)') is not null then
		revoke all on function public.accept_pending_business_invites_for_user(text, uuid)
			from public, anon, authenticated;
		grant execute on function public.accept_pending_business_invites_for_user(text, uuid)
			to service_role;
	end if;

	if to_regprocedure('public.business_commercial_status(uuid)') is not null then
		revoke all on function public.business_commercial_status(uuid)
			from public, anon, authenticated;
		grant execute on function public.business_commercial_status(uuid)
			to service_role;
	end if;

	if to_regprocedure('public.user_is_active_owner(uuid, uuid)') is not null then
		revoke all on function public.user_is_active_owner(uuid, uuid)
			from public, anon, authenticated;
		grant execute on function public.user_is_active_owner(uuid, uuid)
			to service_role;
	end if;

	if to_regprocedure('public.count_active_business_owners(uuid)') is not null then
		revoke all on function public.count_active_business_owners(uuid)
			from public, anon, authenticated;
		grant execute on function public.count_active_business_owners(uuid)
			to service_role;
	end if;
end;
$$;

notify pgrst, 'reload schema';

-- Esta función de compatibilidad quedó fuera del flujo actual, pero su versión
-- hospedada era SECURITY DEFINER y conservaba EXECUTE para authenticated. Podía
-- recorrer y archivar reservas retenidas de todos los consultorios desde un RPC
-- directo. El scheduler actual no la usa: los turnos vigentes se gestionan por
-- las funciones internas autorizadas. Se conserva la función para no romper el
-- historial, pero se cierra su superficie pública.
do $$
begin
	-- La función sólo existe en algunos proyectos históricos. La migración debe
	-- ser reproducible desde cero y también segura al aplicarse sobre esos
	-- proyectos, por eso la revocación se ejecuta sólo si el objeto está presente.
	if to_regprocedure('public.expire_public_booking_holds()') is not null then
		execute 'revoke all on function public.expire_public_booking_holds() from public, anon, authenticated';
	end if;
end $$;

notify pgrst, 'reload schema';

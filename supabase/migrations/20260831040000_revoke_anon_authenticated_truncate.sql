-- RLS no protege TRUNCATE. El grant heredado de la base inicial permitía que
-- anon/authenticated intentaran vaciar tablas completas aunque no pudieran leer
-- ni modificar sus filas. Revocamos sólo ese privilegio en los esquemas de datos
-- y también evitamos que vuelva a aparecer por privilegios por defecto.
revoke truncate on all tables in schema public from anon, authenticated;

alter default privileges in schema public
	revoke truncate on tables from anon, authenticated;

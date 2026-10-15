-- La política heredada `allowed_emails_master_read` se creó con USING (true)
-- y hacía visible la lista de acceso a cualquier usuario autenticado. El flujo
-- de aplicación consulta esta tabla sólo con el cliente server-role; el maestro
-- sigue cubierto por las políticas explícitas con comprobación de su identidad.
drop policy if exists allowed_emails_master_read on public.allowed_emails;

notify pgrst, 'reload schema';

-- Restaura el SELECT de `authenticated` sobre la tabla patients.
--
-- Síntoma: el detalle de paciente fallaba en producción con
--   42501 "permission denied for table patients"
-- mientras que la lista funcionaba.
--
-- Causa: en la base remota, patients había quedado con permisos POR COLUMNA que
-- cubrían las columnas que pide la lista (id, full_name, dni, phone, archived_at,
-- last_entry_at, updated_at, created_at) pero NO las que pide el detalle
-- (email, birth_date, address, insurance, insurance_plan, drive_folder_id).
-- Ninguna migración gestionaba los grants de patients (dependían del default de
-- Supabase), por eso local y remoto divergieron tras el "clinical data split".
--
-- Conceder SELECT a nivel tabla cubre todas las columnas actuales y futuras. El
-- acceso por fila sigue gobernado por la política RLS patients_role_scoped_select,
-- así que este grant es seguro.

grant select on table patients to authenticated;

notify pgrst, 'reload schema';

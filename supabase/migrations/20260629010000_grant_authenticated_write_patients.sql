-- La agenda y la ficha de pacientes escriben sobre `patients` desde sesiones
-- authenticated y dejan el alcance real a cargo de RLS.
--
-- En la base remota encontramos `permission denied for table patients` al crear
-- un turno manual con paciente nuevo: existia GRANT SELECT explicito, pero no
-- INSERT/UPDATE/DELETE a nivel tabla. Las policies siguen limitando filas por
-- negocio y rol (`patients_business_operator_*`, `patients_role_scoped_select`).

grant select, insert, update, delete on table public.patients to authenticated;

notify pgrst, 'reload schema';

-- Las políticas históricas basadas únicamente en owner_id permitían que un
-- usuario autenticado insertara o leyera pacientes y fichas clínicas en otro
-- consultorio. Las políticas actuales exigen pertenencia al negocio y el rol
-- correspondiente; se eliminan sólo las cuatro variantes obsoletas de cada
-- tabla, sin tocar datos, columnas, RLS ni funciones.

drop policy if exists patients_delete on public.patients;
drop policy if exists patients_insert on public.patients;
drop policy if exists patients_select on public.patients;
drop policy if exists patients_update on public.patients;

drop policy if exists entries_delete on public.clinical_entries;
drop policy if exists entries_insert on public.clinical_entries;
drop policy if exists entries_select on public.clinical_entries;
drop policy if exists entries_update on public.clinical_entries;

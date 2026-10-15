-- Seguimientos se operan exclusivamente mediante endpoints server-side que
-- aplican el scope de rol, pertenencia del paciente y control optimista. Las
-- políticas históricas permitían que cualquier miembro autenticado leyera o
-- mutara seguimientos arbitrarios por PostgREST, fuera de ese scope.

drop policy if exists follow_ups_select on public.follow_ups;
drop policy if exists follow_ups_write on public.follow_ups;

revoke all on table public.follow_ups from public, anon, authenticated;
grant select, insert, update, delete on table public.follow_ups to service_role;

notify pgrst, 'reload schema';

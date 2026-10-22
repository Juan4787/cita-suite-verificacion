-- Committed synthetic pre-upgrade state: a privileged function with the strictest path, "", as the
-- functions of another product in production hold it. Runs only in the owned disposable DB.
begin;
create function public.cita_upgrade_empty_path_probe() returns integer
  language sql stable security definer set search_path = '' as $$ select 1 $$;
revoke all on function public.cita_upgrade_empty_path_probe() from public, anon, authenticated;
commit;

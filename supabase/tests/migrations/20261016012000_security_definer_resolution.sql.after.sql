-- The resolution of privileged functions keeps an empty path, the strictest setting, instead of
-- refusing it (production's dry run failed on exactly this), and still rewrites every other one.
-- The probe is then removed exactly, so the generated types stay those of the migrations.
create extension if not exists pgtap with schema extensions;
begin;
select extensions.plan(2);
select extensions.is((select array_to_string(proconfig,',') from pg_proc where oid='public.cita_upgrade_empty_path_probe()'::regprocedure),
  'search_path=""','an empty path stays as it was');
select extensions.ok((select bool_and(coalesce((select split_part(setting,'=',2) ~ '(^|,)[[:space:]]*pg_temp[[:space:]]*$' from unnest(p.proconfig) setting
  where setting like 'search_path=%'),false)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.prosecdef and p.oid<>'public.cita_upgrade_empty_path_probe()'::regprocedure
   and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')),
  'every other privileged function resolves temporary schemas last');
select * from extensions.finish();
drop function public.cita_upgrade_empty_path_probe();
commit;

-- Preserve trusted schema order while preventing caller-created temporary
-- relations from shadowing application objects inside privileged functions.
-- Bodies, signatures, ownership, execution grants and data are unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $migration$
declare
 fn record;
 current_path text;
 schema_name text;
 trusted_path text[];
 target text;
begin
 for fn in
  select p.oid,p.proconfig,n.nspname,p.proname
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.prosecdef and p.prokind='f'
   and not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
  order by n.nspname,p.proname,p.oid
 loop
  target:=format('%I.%I(%s)',fn.nspname,fn.proname,pg_catalog.pg_get_function_identity_arguments(fn.oid));
  select split_part(setting,'=',2) into current_path from unnest(fn.proconfig) setting where setting like 'search_path=%';
  if current_path is null or btrim(current_path)='' then
   raise exception 'EXPLICIT_FUNCTION_SEARCH_PATH_REQUIRED: %',target;
  end if;
  -- An empty path ("") is the strictest setting: the function must name every object with its
  -- schema, so nothing it names can be shadowed. It keeps it.
  continue when btrim(current_path)='""';
  trusted_path:=array[]::text[];
  foreach schema_name in array string_to_array(current_path,',') loop
   schema_name:=btrim(schema_name);
   if schema_name not in('pg_catalog','public','private','extensions','storage','auth','realtime','pg_temp') then
    raise exception 'UNEXPECTED_FUNCTION_SEARCH_PATH: %',target;
   end if;
   if schema_name<>'pg_temp' then trusted_path:=array_append(trusted_path,format('%I',schema_name)); end if;
  end loop;
  trusted_path:=array_append(trusted_path,'pg_temp');
  execute format('alter function %s set search_path to %s',target,array_to_string(trusted_path,', '));
 end loop;
end;
$migration$;
notify pgrst,'reload schema';
commit;

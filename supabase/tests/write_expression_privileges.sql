-- A check constraint, a column default, a row policy or a view runs the functions it
-- calls with the privileges of whoever reads or writes the row, not of whoever created
-- it. A role allowed to use a public table must therefore be able to execute every
-- function those expressions call (a role that bypasses row level security never
-- evaluates the policies); otherwise each of its writes fails with
-- "permission denied for function", as the Google review settings did for owners, the
-- account assistance and the backend alike. Catalog checks only; everything is rolled
-- back.
begin;
select extensions.plan(1);

do $$
declare v_unexecutable text;
begin
 with api_roles(role_name) as (values ('anon'::name), ('authenticated'::name), ('service_role'::name)),
 expression_functions as (
  select c.conrelid as table_oid, d.refobjid as function_oid, 'check ' || c.conname as source,
   'INSERT,UPDATE' as needs, null::oid as policy_oid
  from pg_constraint c
  join pg_depend d on d.classid = 'pg_constraint'::regclass and d.objid = c.oid and d.refclassid = 'pg_proc'::regclass
  where c.contype = 'c' and c.connamespace = 'public'::regnamespace
  union
  select a.adrelid, d.refobjid, 'default ' || att.attname,
   case when att.attgenerated <> '' then 'INSERT,UPDATE' else 'INSERT' end, null
  from pg_attrdef a
  join pg_attribute att on att.attrelid = a.adrelid and att.attnum = a.adnum
  join pg_depend d on d.classid = 'pg_attrdef'::regclass and d.objid = a.oid and d.refclassid = 'pg_proc'::regclass
  join pg_class t on t.oid = a.adrelid
  where t.relnamespace = 'public'::regnamespace
  union
  select p.polrelid, d.refobjid, 'policy ' || p.polname,
   case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE'
    else 'SELECT,INSERT,UPDATE,DELETE' end,
   p.oid
  from pg_policy p
  join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = p.oid and d.refclassid = 'pg_proc'::regclass
  join pg_class t on t.oid = p.polrelid
  where t.relnamespace = 'public'::regnamespace
  union
  select r.ev_class, d.refobjid, 'view', 'SELECT', null
  from pg_rewrite r
  join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid and d.refclassid = 'pg_proc'::regclass
  join pg_class t on t.oid = r.ev_class
  where t.relnamespace = 'public'::regnamespace and t.relkind in ('v', 'm')
 )
 select string_agg(format('%s %s -> %s for %s', f.table_oid::regclass, f.source, f.function_oid::regprocedure, r.role_name),
   '; ' order by f.table_oid::regclass::text, f.source, r.role_name)
 into v_unexecutable
 from expression_functions f cross join api_roles r
 where has_table_privilege(r.role_name, f.table_oid, f.needs)
  and (f.policy_oid is null or exists (
   select 1 from pg_policy p join pg_roles api_role on api_role.rolname = r.role_name
   where p.oid = f.policy_oid and not api_role.rolbypassrls
    and (0::oid = any(p.polroles) or api_role.oid = any(p.polroles))))
  and not has_function_privilege(r.role_name, f.function_oid, 'EXECUTE');
 if v_unexecutable is not null then raise exception 'TEST_UNEXECUTABLE_EXPRESSION_FUNCTION %', v_unexecutable; end if;
end $$;
select extensions.pass('every role allowed to use a public table can execute the functions its checks, defaults, policies and views call');

select * from extensions.finish();
rollback;

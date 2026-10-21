-- Supabase stops granting the Data API roles on new public tables and sequences of
-- existing projects on 30 October 2026, as it already does for projects created
-- since 30 May. Every environment follows that rule from migration 20261021020000 on:
-- what a migration creates is reachable only through the grants it writes, and the
-- public anon key reaches no table at all. Catalog checks and a probe table only;
-- everything is rolled back.
begin;
select extensions.plan(3);

-- 1. The schema owner's default privileges give the API roles nothing.
do $$
declare v_acl text;
begin
 select string_agg(d.defaclobjtype::text||':'||d.defaclacl::text, ' ') into v_acl
 from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
 where n.nspname='public' and d.defaclrole='postgres'::regrole
  and d.defaclacl::text ~ '(^|[{,])(anon|authenticated|service_role)=';
 if v_acl is not null then raise exception 'TEST_API_DEFAULT_PRIVILEGES %',v_acl; end if;
end $$;
select extensions.pass('new public objects get no automatic Data API grant');

-- 2. A table the schema owner creates now is reachable by no API role until a
-- migration grants it.
set local role postgres;
create table public.api_exposure_probe(id integer);
reset role;
select extensions.ok(
 not has_table_privilege('anon','public.api_exposure_probe','SELECT')
 and not has_table_privilege('authenticated','public.api_exposure_probe','SELECT')
 and not has_table_privilege('service_role','public.api_exposure_probe','SELECT'),
 'a new public table needs an explicit grant before the Data API can reach it');

-- 3. The public anon key has no privilege on any public table, view or sequence.
do $$
declare v_relations text;
begin
 select string_agg(c.relname, ', ' order by c.relname) into v_relations
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p','v','m','f','S') and c.relname<>'api_exposure_probe'
  and (case when c.relkind='S' then has_sequence_privilege('anon',c.oid,'USAGE,SELECT,UPDATE')
       else has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') end);
 if v_relations is not null then raise exception 'TEST_ANON_RELATION_PRIVILEGES %',v_relations; end if;
end $$;
select extensions.pass('the anon key reaches no public table, view or sequence directly');

select * from extensions.finish();
rollback;

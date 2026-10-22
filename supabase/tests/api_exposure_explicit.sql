-- Supabase stops granting the Data API roles on new public tables and sequences of
-- existing projects on 30 October 2026, as it already does for projects created
-- since 30 May. Every environment follows that rule from migration 20261021020000 on:
-- what a migration creates is reachable only through the grants it writes, and the
-- public anon key reaches no table at all. Catalog checks and a probe table only;
-- everything is rolled back.
begin;
select extensions.plan(5);

-- 1. The default privileges of the roles that apply migrations give the API roles
-- nothing: postgres in hosted projects, supabase_admin in this reconstruction.
do $$
declare v_acl text;
begin
 select string_agg(pg_get_userbyid(d.defaclrole)||' '||d.defaclobjtype::text||':'||d.defaclacl::text, ' ') into v_acl
 from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
 where n.nspname='public' and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole)
  and d.defaclacl::text ~ '(^|[{,])(anon|authenticated|service_role)=';
 if v_acl is not null then raise exception 'TEST_API_DEFAULT_PRIVILEGES %',v_acl; end if;
end $$;
select extensions.pass('new public objects get no automatic Data API grant');

-- 2. A table created now, as a migration here or in a hosted project would create
-- it, is reachable by no API role until a migration grants it.
create table public.api_exposure_probe(id integer);
set local role postgres;
create table public.api_exposure_probe_hosted(id integer);
reset role;
select extensions.ok(
 not exists(select 1 from unnest(array['public.api_exposure_probe','public.api_exposure_probe_hosted']) probe,
  unnest(array['anon','authenticated','service_role']) api_role
  where has_table_privilege(api_role, probe, 'SELECT,INSERT,UPDATE,DELETE')),
 'a new public table needs an explicit grant before the Data API can reach it');

-- 3. The public anon key has no privilege on any public table, view or sequence.
do $$
declare v_relations text;
begin
 select string_agg(c.relname, ', ' order by c.relname) into v_relations
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p','v','m','f','S') and c.relname not like 'api\_exposure\_probe%'
  and (case when c.relkind='S' then has_sequence_privilege('anon',c.oid,'USAGE,SELECT,UPDATE')
       else has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') end);
 if v_relations is not null then raise exception 'TEST_ANON_RELATION_PRIVILEGES %',v_relations; end if;
end $$;
select extensions.pass('the anon key reaches no public table, view or sequence directly');

-- API roles hold no privilege beyond reading and writing rows, as the migrations grant:
-- the automatic grants also gave TRUNCATE, REFERENCES, TRIGGER and MAINTAIN.
select extensions.ok(not exists (
 select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  and (has_table_privilege('authenticated', c.oid, 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
   or has_table_privilege('anon', c.oid, 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))
), 'API roles hold no privilege beyond reading and writing rows');

-- 5. The anon key executes no privileged function of the exposed schema: each would be an RPC that
-- runs as its owner for anyone holding the public key.
select extensions.ok(not exists (
 select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
), 'the anon key executes no privileged public function');

select * from extensions.finish();
rollback;

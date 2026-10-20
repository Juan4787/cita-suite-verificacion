-- Removes the synthetic practices of scripts/capacity/seed-practices.sql and every
-- row that belongs to them, in one transaction, and nothing else. A practice is
-- synthetic when its slug is `capacity-NN` and its id is the deterministic id the
-- seed gives that slug; a member other than its synthetic owner stops everything.
-- The order follows the restrictions the schema keeps on purpose: a public
-- booking's context and the patient's answers restrict deleting its integration
-- and its patient, so the appointments go first and take them along; then the
-- integrations, which restrict deleting their practice; then the practice, whose
-- remaining rows follow by cascade. Documents keep objects in Storage and their
-- accounting, which SQL does not remove: a practice with documents is refused.
-- The owners are removed afterwards through the Auth admin API.
--   psql -f cleanup-practices.sql
\set ON_ERROR_STOP on
begin;
create temporary table capacity_cleanup on commit drop as
select b.id from public.businesses b
-- CASE guards the cast: AND gives no evaluation order.
where b.id = case when b.slug ~ '^capacity-[0-9]{2}$'
 then overlay(overlay(md5('capacity-practice-'||substr(b.slug,10)::integer) placing '4' from 13) placing '8' from 17)::uuid end;
do $$
begin
 if exists(select 1 from public.businesses b where b.slug like 'capacity-%' and b.id not in (select id from capacity_cleanup)) then
  raise exception 'CAPACITY_CLEANUP_UNKNOWN_PRACTICE';
 end if;
 if exists(select 1 from public.business_users u join public.businesses b on b.id=u.business_id join capacity_cleanup c on c.id=b.id
  left join auth.users a on a.id=u.user_id where a.email is distinct from 'capacity-owner-'||substr(b.slug,10)||'@example.test') then
  raise exception 'CAPACITY_CLEANUP_FOREIGN_MEMBER';
 end if;
 if exists(select 1 from public.patient_radiographs r join capacity_cleanup c on c.id=r.business_id)
  or exists(select 1 from public.clinical_upload_slots s join capacity_cleanup c on c.id=s.business_id) then
  raise exception 'CAPACITY_CLEANUP_HAS_DOCUMENTS';
 end if;
end $$;
create temporary table capacity_cleanup_counts on commit drop as select
 (select count(*) from capacity_cleanup) as practices,
 (select count(*) from public.patients p join capacity_cleanup c on c.id=p.business_id) as patients,
 (select count(*) from public.appointments a join capacity_cleanup c on c.id=a.business_id) as appointments;
-- Practice by practice, one statement each and all in this transaction: a hosted
-- project limits how long one statement runs.
select format('delete from public.appointments where business_id=%L',id) from capacity_cleanup order by id \gexec
delete from public.booking_integrations i using capacity_cleanup c where i.business_id=c.id;
select format('delete from public.businesses where id=%L',id) from capacity_cleanup order by id \gexec
-- Nothing of these practices remains in any table that names its practice.
do $$
declare r record; v_count bigint; v_left jsonb:='{}';
begin
 for r in select c.table_schema,c.table_name from information_schema.columns c
  join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
  where c.column_name='business_id' and c.table_schema in ('public','private') and t.table_type='BASE TABLE' loop
  execute format('select count(*) from %I.%I where business_id in (select id from capacity_cleanup)',r.table_schema,r.table_name) into v_count;
  if v_count>0 then v_left:=v_left||jsonb_build_object(r.table_schema||'.'||r.table_name,v_count); end if;
 end loop;
 if v_left<>'{}' then raise exception 'CAPACITY_CLEANUP_LEFT %',v_left; end if;
end $$;
select 'capacity-cleanup '||to_jsonb(c)::text from capacity_cleanup_counts c;
commit;

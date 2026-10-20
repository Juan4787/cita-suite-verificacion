-- Reading patients is evaluated once per statement (20261020020000). For every
-- role, the rows visible through the policy and those returned by the list and
-- count functions are exactly the rows the single-row rule user_can_read_basic_patient
-- approves, and reading a whole practice evaluates that rule zero times instead of
-- once per patient. Synthetic data only; everything is rolled back.
begin;
select extensions.plan(6);

create temporary table read_business(label text primary key, id uuid not null);
create temporary table read_actor(label text primary key, user_id uuid not null, business text);
create temporary table read_patient(label text primary key, business text not null, id uuid not null);
grant select on read_business, read_actor, read_patient to authenticated;

do $$
declare
 b1 uuid:=gen_random_uuid(); b2 uuid:=gen_random_uuid();
 u_owner uuid:=gen_random_uuid(); u_admin uuid:=gen_random_uuid(); u_reception uuid:=gen_random_uuid(); u_readonly uuid:=gen_random_uuid();
 u_professional uuid:=gen_random_uuid(); u_support uuid:=gen_random_uuid(); u_stranger uuid:=gen_random_uuid();
 u_owner2 uuid:=gen_random_uuid(); u_professional2 uuid:=gen_random_uuid();
 p_linked uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid(); p_restricted uuid:=gen_random_uuid();
 v_patient uuid;
begin
 insert into auth.users(id,email) select id,'read-'||id||'@example.test'
 from unnest(array[u_owner,u_admin,u_reception,u_readonly,u_professional,u_support,u_stranger,u_owner2,u_professional2]) id;
 insert into public.businesses(id,name,slug,industry) values(b1,'Lectura uno',b1::text,'other'),(b2,'Lectura dos',b2::text,'other');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b1;
 -- Restricted practice: owners keep the restricted read, operation (and so professionals) stops.
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=false,subscription_status='restricted',
  paid_until=now()-interval '20 days',grace_until=now()-interval '10 days',restricted_until=now()+interval '30 days',archived_at=null where business_id=b2;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values
  (b1,u_owner,'owner','active',now()),(b1,u_admin,'admin','active',now()),(b1,u_reception,'reception','active',now()),
  (b1,u_readonly,'readonly','active',now()),(b1,u_professional,'professional','active',now()),
  (b2,u_owner2,'owner','active',now()),(b2,u_professional2,'professional','active',now());
 insert into public.account_assistance_support_users(user_id,email) values(u_support,'read-support-'||u_support||'@example.test');
 insert into public.account_assistance_grants(business_id,requested_by_user_id,support_user_id,expires_at) values(b1,u_owner,u_support,now()+interval '1 hour');
 insert into public.professionals(id,business_id,name) values(p_linked,b1,'Profesional vinculado'),(p_other,b1,'Otra profesional'),(p_restricted,b2,'Profesional restringido');
 insert into public.professional_users(business_id,user_id,professional_id) values(b1,u_professional,p_linked),(b2,u_professional2,p_restricted);
 for i in 1..12 loop
  insert into public.patients(owner_id,business_id,full_name,archived_at) values(u_owner,b1,'Paciente lectura '||i,case when i=12 then now() end) returning id into v_patient;
  insert into read_patient values('a'||i,'b1',v_patient);
  -- The professional reads 1-4 (active links); 5 has an inactive link and 6 belongs to a colleague.
  if i<=5 then
   insert into public.professional_patient_links(business_id,professional_id,patient_id,source,is_active,created_by)
   values(b1,p_linked,v_patient,'manual',i<=4,u_owner);
  elsif i=6 then
   insert into public.professional_patient_links(business_id,professional_id,patient_id,source,is_active,created_by)
   values(b1,p_other,v_patient,'manual',true,u_owner);
  end if;
 end loop;
 for i in 1..4 loop
  insert into public.patients(owner_id,business_id,full_name) values(u_owner2,b2,'Paciente restringido '||i) returning id into v_patient;
  insert into read_patient values('b'||i,'b2',v_patient);
  if i=1 then
   insert into public.professional_patient_links(business_id,professional_id,patient_id,source,is_active,created_by)
   values(b2,p_restricted,v_patient,'manual',true,u_owner2);
  end if;
 end loop;
 insert into read_business values('b1',b1),('b2',b2);
 insert into read_actor values('owner',u_owner,'b1'),('admin',u_admin,'b1'),('reception',u_reception,'b1'),('readonly',u_readonly,'b1'),
  ('professional',u_professional,'b1'),('support',u_support,'b1'),('stranger',u_stranger,null),
  ('restricted owner',u_owner2,'b2'),('restricted professional',u_professional2,'b2');
end $$;

-- 1. Reading a whole practice evaluates the single-row rule zero times; the practice
-- set is computed once per statement, not once per row.
set local track_functions='all';
do $$
declare
 -- Resolved by name so the per-row failure, not a missing helper, is what shows
 -- before the fix; check 6 requires the helpers on their own.
 v_rule regprocedure:='public.user_can_read_basic_patient(uuid,uuid)'; v_readers regprocedure:=to_regprocedure('public.user_patient_reader_business_ids()');
 v_rule_before bigint; v_readers_before bigint; v_count bigint; v_listed integer; v_counted bigint;
begin
 perform set_config('request.jwt.claim.sub',(select user_id::text from read_actor where label='owner'),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 v_rule_before:=coalesce(pg_stat_get_xact_function_calls(v_rule),0);
 v_readers_before:=coalesce(pg_stat_get_xact_function_calls(v_readers),0);
 execute 'set local role authenticated';
 select count(*) into v_count from public.patients where business_id=(select id from read_business where label='b1');
 select count(*) into v_listed from public.list_accessible_patients_page((select id from read_business where label='b1'),false,'',30);
 select total_count into v_counted from public.accessible_patient_counts((select id from read_business where label='b1'));
 execute 'reset role';
 if coalesce(v_count<>12 or v_listed<>11 or v_counted<>12,true) then raise exception 'TEST_OWNER_READ_COUNTS % % %',v_count,v_listed,v_counted; end if;
 if coalesce(coalesce(pg_stat_get_xact_function_calls(v_rule),0)-v_rule_before<>0,true) then
  raise exception 'TEST_PER_ROW_RULE_EVALUATED %',coalesce(pg_stat_get_xact_function_calls(v_rule),0)-v_rule_before;
 end if;
 if v_readers is not null and coalesce(coalesce(pg_stat_get_xact_function_calls(v_readers),0)-v_readers_before>3,true) then
  raise exception 'TEST_PRACTICE_SET_PER_ROW %',coalesce(pg_stat_get_xact_function_calls(v_readers),0)-v_readers_before;
 end if;
end $$;
select extensions.pass('reading a whole practice evaluates the single-row rule zero times');

-- 2. The policy shows each role exactly the rows the single-row rule approves.
do $$
declare actor record; v_reference uuid[]; v_policy uuid[];
begin
 for actor in select * from read_actor order by label loop
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  select coalesce(array_agg(p.id order by p.id),'{}') into v_reference from public.patients p
  where p.business_id in (select id from read_business) and public.user_can_read_basic_patient(p.business_id,p.id);
  execute 'set local role authenticated';
  select coalesce(array_agg(p.id order by p.id),'{}') into v_policy from public.patients p where p.business_id in (select id from read_business);
  execute 'reset role';
  if v_policy is distinct from v_reference then raise exception 'TEST_POLICY_MISMATCH % reference % policy %',actor.label,v_reference,v_policy; end if;
 end loop;
end $$;
select extensions.pass('the policy shows each role exactly the rows the single-row rule approves');

-- 3. The expected visibility itself, so equivalence cannot hide a common mistake.
do $$
declare actor record; v_visible text[]; v_expected text[];
begin
 for actor in select * from read_actor order by label loop
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  select coalesce(array_agg(r.label order by r.label),'{}') into v_visible from public.patients p join read_patient r on r.id=p.id;
  execute 'reset role';
  v_expected:=case actor.label
   when 'professional' then array['a1','a2','a3','a4']
   when 'restricted professional' then '{}'::text[]
   when 'stranger' then '{}'::text[]
   when 'restricted owner' then array['b1','b2','b3','b4']
   else (select array_agg('a'||i order by 'a'||i) from generate_series(1,12) i)
  end;
  if v_visible is distinct from v_expected then raise exception 'TEST_VISIBILITY % expected % got %',actor.label,v_expected,v_visible; end if;
 end loop;
end $$;
select extensions.pass('owners, admins, support, reception and readonly read the practice; professionals only their active links; restricted practices only their owners');

-- 4. The list and the counts return what the rule approves, with the archive rules.
do $$
declare actor record; v_business uuid; v_reference uuid[]; v_list uuid[]; v_archived uuid[]; v_counts record; v_professional boolean;
begin
 for actor in select * from read_actor where business is not null order by label loop
  v_business:=(select id from read_business where label=actor.business);
  v_professional:=actor.label like '%professional';
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  select coalesce(array_agg(p.id order by p.id),'{}') into v_reference from public.patients p
  where p.business_id=v_business and public.user_can_read_basic_patient(p.business_id,p.id) and p.archived_at is null;
  execute 'set local role authenticated';
  select coalesce(array_agg(l.id order by l.id),'{}') into v_list from public.list_accessible_patients_page(v_business,false,'',30) l;
  select coalesce(array_agg(l.id order by l.id),'{}') into v_archived from public.list_accessible_patients_page(v_business,true,'',30) l;
  select * into v_counts from public.accessible_patient_counts(v_business);
  execute 'reset role';
  if v_list is distinct from v_reference then raise exception 'TEST_LIST_MISMATCH % reference % list %',actor.label,v_reference,v_list; end if;
  if coalesce(v_counts.active_count<>cardinality(v_reference)
   or v_counts.total_count<>cardinality(v_reference)+case when v_professional then 0 else cardinality(v_archived) end,true) then
   raise exception 'TEST_COUNT_MISMATCH % %',actor.label,row_to_json(v_counts);
  end if;
  if coalesce(cardinality(v_archived)<>case when v_professional or actor.business='b2' then 0 else 1 end,true) then
   raise exception 'TEST_ARCHIVED_LIST % %',actor.label,v_archived;
  end if;
 end loop;
end $$;
select extensions.pass('the patient list and counts return exactly what the rule approves, with the archive rules');

-- 5. A search keeps its matches and its rank within the readable rows.
do $$
declare v_rows integer;
begin
 perform set_config('request.jwt.claim.sub',(select user_id::text from read_actor where label='professional'),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 select count(*) into v_rows
 from public.list_accessible_patients_page((select id from read_business where label='b1'),false,'lectura',30);
 execute 'reset role';
 if coalesce(v_rows<>4,true) then raise exception 'TEST_PROFESSIONAL_SEARCH %',v_rows; end if;
end $$;
select extensions.pass('a professional search matches only the linked patients');

-- 6. The new helpers are callable only by signed-in users and the server.
select extensions.ok(
 not has_function_privilege('anon','public.user_patient_reader_business_ids()','execute')
 and not has_function_privilege('anon','public.user_linked_patient_ids()','execute')
 and has_function_privilege('authenticated','public.user_patient_reader_business_ids()','execute')
 and has_function_privilege('authenticated','public.user_linked_patient_ids()','execute'),
 'the set helpers are not executable anonymously');

select * from extensions.finish();
rollback;

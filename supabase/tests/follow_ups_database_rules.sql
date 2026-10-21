-- Follow-up rules live in the database: who reads which follow-up (row level
-- security, filtered before any limit), and each change in one function that checks
-- the actor, the patient link, the practice's operation and the version in the same
-- transaction. A restricted practice keeps its owners' read access only, as patients
-- do. Synthetic data only; everything is rolled back.
begin;
select extensions.plan(7);

create temporary table fu_fixture(label text primary key, id uuid not null);
grant select on fu_fixture to authenticated;

do $$
declare
 b uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
 u_owner uuid:=gen_random_uuid(); u_reception uuid:=gen_random_uuid(); u_pro1 uuid:=gen_random_uuid(); u_pro2 uuid:=gen_random_uuid();
 u_readonly uuid:=gen_random_uuid(); u_stranger uuid:=gen_random_uuid();
 p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); x uuid; y uuid;
begin
 insert into auth.users(id,email) select id,'follow-up-rules-'||id||'@example.test'
  from unnest(array[u_owner,u_reception,u_pro1,u_pro2,u_readonly,u_stranger]) id;
 insert into public.businesses(id,name,slug,industry,timezone) values(b,'Seguimientos',b::text,'other','America/Argentina/Buenos_Aires');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values
  (b,u_owner,'owner','active',now()),(b,u_reception,'reception','active',now()),(b,u_pro1,'professional','active',now()),
  (b,u_pro2,'professional','active',now()),(b,u_readonly,'readonly','active',now());
 insert into public.professionals(id,business_id,name) values(p1,b,'Profesional uno'),(p2,b,'Profesional dos');
 insert into public.professional_users(business_id,user_id,professional_id) values(b,u_pro1,p1),(b,u_pro2,p2);
 insert into public.patients(owner_id,business_id,full_name) values(u_owner,b,'Paciente equis') returning id into x;
 insert into public.patients(owner_id,business_id,full_name) values(u_owner,b,'Paciente ye') returning id into y;
 insert into public.professional_patient_links(business_id,professional_id,patient_id,source,is_active,created_by)
  values(b,p1,x,'manual',true,u_owner),(b,p2,y,'manual',true,u_owner);
 insert into fu_fixture values('business',b),('owner',u_owner),('reception',u_reception),('pro1',u_pro1),('pro2',u_pro2),
  ('readonly',u_readonly),('stranger',u_stranger),('p1',p1),('p2',p2),('x',x),('y',y);
 -- f1: X assigned to p1 (linked). f2: Y assigned to p2 (linked). f3: X assigned to p2 (p2 not linked to X).
 with created as (
  insert into public.follow_ups(business_id,patient_id,assigned_professional_id,remind_on,message)
  values(b,x,p1,current_date,'Uno'),(b,y,p2,current_date+1,'Dos'),(b,x,p2,current_date+2,'Tres') returning id,message
 )
 insert into fu_fixture select case message when 'Uno' then 'f1' when 'Dos' then 'f2' else 'f3' end,id from created;
end $$;

-- Runs a statement as the actor and returns its result, or the error it raised.
create function pg_temp.as_actor(p_actor text, p_statement text) returns text language plpgsql as $$
declare v_result text;
begin
 perform set_config('request.jwt.claim.sub',coalesce((select id::text from fu_fixture where label=p_actor),''),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin
  execute 'set local role authenticated';
  execute p_statement into v_result;
  execute 'reset role';
 exception when others then
  return 'ERROR '||sqlerrm;
 end;
 return coalesce(v_result,'');
end $$;
create function pg_temp.visible(p_actor text) returns text language sql as $$
 select pg_temp.as_actor(p_actor,
  'select coalesce(string_agg(l.label, '','' order by l.label), '''') from public.follow_ups f join fu_fixture l on l.id=f.id')
$$;
create function pg_temp.fid(p_label text) returns uuid language sql as $$ select id from fu_fixture where label=p_label $$;

-- 1. Who reads what, in an operating practice.
do $$
declare v text:=concat_ws(' | ', pg_temp.visible('owner'), pg_temp.visible('reception'), pg_temp.visible('pro1'),
 pg_temp.visible('pro2'), pg_temp.visible('readonly'), pg_temp.visible('stranger'));
begin
 if v is distinct from 'f1,f2,f3 | f1,f2,f3 | f1 | f2 |  | ' then raise exception 'TEST_FOLLOW_UP_READ_SCOPE %',v; end if;
end $$;
select extensions.pass('owners and reception read the practice, a professional only what is assigned to a linked patient');

-- 2. A professional whose link to the patient is archived stops reading that follow-up.
do $$
declare v text;
begin
 update public.professional_patient_links set is_active=false where professional_id=pg_temp.fid('p1') and patient_id=pg_temp.fid('x');
 v:=pg_temp.visible('pro1');
 update public.professional_patient_links set is_active=true where professional_id=pg_temp.fid('p1') and patient_id=pg_temp.fid('x');
 if v<>'' then raise exception 'TEST_FOLLOW_UP_ARCHIVED_LINK_READS %',v; end if;
end $$;
select extensions.pass('an archived link hides the follow-up from its professional');

-- 3. In a restricted practice only owners and administrators keep reading, as with patients.
do $$
declare v text;
begin
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=false,subscription_status='restricted',
  paid_until=now()-interval '20 days',grace_until=now()-interval '10 days',restricted_until=now()+interval '30 days',archived_at=null
  where business_id=pg_temp.fid('business');
 v:=concat_ws(' | ', pg_temp.visible('owner'), pg_temp.visible('reception'), pg_temp.visible('pro1'));
 update public.business_subscriptions set is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null
  where business_id=pg_temp.fid('business');
 if v is distinct from 'f1,f2,f3 |  | ' then raise exception 'TEST_FOLLOW_UP_RESTRICTED_READS %',v; end if;
end $$;
select extensions.pass('a restricted practice keeps follow-ups readable only by its owners and administrators');

-- 4. Creating: a professional for a linked patient, reception assigning a linked professional;
-- the rest is refused with its reason. Days count from the practice's local today.
do $$
declare v text;
 create_as text:='select public.create_follow_up(%L,%L,(now() at time zone ''America/Argentina/Buenos_Aires'')::date+%s,%L,%s)::text';
begin
 v:=concat_ws(' | ',
  left(pg_temp.as_actor('pro1', format(create_as, pg_temp.fid('business'), pg_temp.fid('x'), 1, 'Llamar', 'null')),5),
  pg_temp.as_actor('pro1', format(create_as, pg_temp.fid('business'), pg_temp.fid('y'), 1, 'Llamar', 'null')),
  left(pg_temp.as_actor('reception', format(create_as, pg_temp.fid('business'), pg_temp.fid('x'), 1, 'Llamar', quote_literal(pg_temp.fid('p1')))),5),
  pg_temp.as_actor('reception', format(create_as, pg_temp.fid('business'), pg_temp.fid('x'), 1, 'Llamar', quote_literal(pg_temp.fid('p2')))),
  pg_temp.as_actor('reception', format(create_as, pg_temp.fid('business'), pg_temp.fid('x'), -1, 'Llamar', quote_literal(pg_temp.fid('p1')))),
  pg_temp.as_actor('stranger', format(create_as, pg_temp.fid('business'), pg_temp.fid('x'), 1, 'Llamar', quote_literal(pg_temp.fid('p1')))));
 if v !~ '^[0-9a-f]{5} \| ERROR FOLLOWUP_PATIENT_NOT_YOURS \| [0-9a-f]{5} \| ERROR FOLLOWUP_PROFESSIONAL_NOT_LINKED \| ERROR FOLLOWUP_INVALID_DATE \| ERROR FOLLOWUP_FORBIDDEN$' then
  raise exception 'TEST_FOLLOW_UP_CREATE %',v;
 end if;
 if (select assigned_professional_id from public.follow_ups where business_id=pg_temp.fid('business') and message='Llamar'
  and created_by=pg_temp.fid('pro1')) is distinct from pg_temp.fid('p1') then
  raise exception 'TEST_FOLLOW_UP_PROFESSIONAL_ASSIGNS_ITSELF';
 end if;
end $$;
select extensions.pass('creating follows the actor, the patient link and the date in the database');

-- 5. A change carries the version it read; a stale one is a conflict, a current one applies.
do $$
declare v_version timestamptz:=(select updated_at from public.follow_ups where id=pg_temp.fid('f1')); v text;
 snooze text:='select public.snooze_follow_up(%L,%L,%L,(now() at time zone ''America/Argentina/Buenos_Aires'')::date+5)::text';
begin
 -- A version a second or less away is the same one serialized with fewer decimals.
 v:=concat_ws(' | ',
  pg_temp.as_actor('pro1', format(snooze, pg_temp.fid('business'), pg_temp.fid('f1'), v_version-interval '1 hour')),
  pg_temp.as_actor('pro1', format(snooze, pg_temp.fid('business'), pg_temp.fid('f1'), v_version-interval '850 milliseconds')));
 if v is distinct from 'ERROR FOLLOWUP_STATUS_CONFLICT | ' then raise exception 'TEST_FOLLOW_UP_VERSION %',v; end if;
 if (select remind_on from public.follow_ups where id=pg_temp.fid('f1'))<>(now() at time zone 'America/Argentina/Buenos_Aires')::date+5 then
  raise exception 'TEST_FOLLOW_UP_SNOOZE_NOT_APPLIED';
 end if;
end $$;
select extensions.pass('a change applies only over the version it read');

-- 6. The authority is checked when the change is made: an archived link refuses it.
do $$
declare v text; v_version timestamptz;
begin
 update public.professional_patient_links set is_active=false where professional_id=pg_temp.fid('p1') and patient_id=pg_temp.fid('x');
 v_version:=(select updated_at from public.follow_ups where id=pg_temp.fid('f1'));
 v:=pg_temp.as_actor('pro1', format('select public.complete_follow_up(%L,%L,%L)::text', pg_temp.fid('business'), pg_temp.fid('f1'), v_version));
 if v is distinct from 'ERROR FOLLOWUP_FORBIDDEN' or (select status from public.follow_ups where id=pg_temp.fid('f1'))<>'pending' then
  raise exception 'TEST_FOLLOW_UP_REVOKED_CHANGE % %',v,(select status from public.follow_ups where id=pg_temp.fid('f1'));
 end if;
end $$;
select extensions.pass('a professional whose link was archived cannot change the follow-up');

-- 7. Signed-in users read through their rules and change only through the functions.
select extensions.ok(
 has_table_privilege('authenticated','public.follow_ups','SELECT')
 and not has_table_privilege('authenticated','public.follow_ups','INSERT,UPDATE,DELETE')
 and not has_table_privilege('anon','public.follow_ups','SELECT')
 and not has_function_privilege('anon','public.create_follow_up(uuid,uuid,date,text,uuid)','execute')
 and has_function_privilege('authenticated','public.create_follow_up(uuid,uuid,date,text,uuid)','execute'),
 'follow-ups are read under row level security and changed only through their functions');

select * from extensions.finish();
rollback;

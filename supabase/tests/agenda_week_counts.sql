-- The weekly agenda counts (20261020050000): appointments of a week counted by the
-- practice's local day and state, under each actor's own read rules, filtered by
-- professional through allocations (joint appointments included), and only for a
-- bounded week. Synthetic data only; everything is rolled back.
begin;
select extensions.plan(5);

create temporary table week_fixture(label text primary key, id uuid not null);
grant select on week_fixture to authenticated;

do $$
declare
 b uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); u_owner uuid:=gen_random_uuid(); u_professional uuid:=gen_random_uuid(); u_stranger uuid:=gen_random_uuid();
 p_linked uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid(); v_patient uuid; v_appointment uuid;
 -- Monday 12:00 UTC of a week two weeks ahead, so every appointment is in the future.
 v_monday timestamptz:=date_trunc('week',now())+interval '14 days 12 hours';
 item record;
begin
 insert into auth.users(id,email) select id,'week-'||id||'@example.test' from unnest(array[u_owner,u_professional,u_stranger]) id;
 insert into public.businesses(id,name,slug,industry,timezone) values(b,'Semana',b::text,'other','America/Argentina/Buenos_Aires');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,u_owner,'owner','active',now()),(b,u_professional,'professional','active',now());
 insert into public.professionals(id,business_id,name) values(p_linked,b,'Profesional vinculado'),(p_other,b,'Otra profesional');
 insert into public.professional_users(business_id,user_id,professional_id) values(b,u_professional,p_linked);
 insert into public.services(id,business_id,name,duration_minutes) values(s,b,'Consulta',30);
 insert into public.professional_services(business_id,professional_id,service_id) values(b,p_linked,s),(b,p_other,s);
 -- Monday: two reserved and one confirmed of the linked professional, one cancelled of the
 -- colleague, and the colleague's joint appointment with the linked professional second.
 -- Tuesday 01:30 UTC is still Monday in Buenos Aires: a reserved appointment of the colleague.
 for item in select * from (values
  ('m1',p_linked,interval '0 hours','reserved'),('m2',p_linked,interval '1 hour','reserved'),('m3',p_linked,interval '2 hours','confirmed'),
  ('m4',p_other,interval '0 hours','cancelled'),('m5',p_other,interval '3 hours','reserved'),('late',p_other,interval '13 hours 30 minutes','reserved'),
  ('t1',p_linked,interval '24 hours','reschedule_requested')) v(label,professional,offset_from_monday,status) loop
  insert into public.patients(owner_id,business_id,full_name) values(u_owner,b,'Paciente '||item.label) returning id into v_patient;
  insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
   status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
  values(b,v_patient,s,item.professional,v_monday+item.offset_from_monday,v_monday+item.offset_from_monday+interval '30 minutes',
   v_monday+item.offset_from_monday,v_monday+item.offset_from_monday+interval '30 minutes',item.status,'manual','Consulta','Profesional',30)
  returning id into v_appointment;
  insert into week_fixture values(item.label,v_appointment);
  if item.label='m5' then
   insert into public.appointment_professionals(business_id,appointment_id,professional_id,position,is_primary) values(b,v_appointment,p_linked,1,false);
  end if;
 end loop;
 insert into week_fixture values('business',b),('owner',u_owner),('professional',u_professional),('stranger',u_stranger),('linked',p_linked),('other',p_other);
 -- The Monday itself, kept as text in a setting for the checks below.
 perform set_config('cita.test_week_monday',v_monday::text,true);
end $$;

create function pg_temp.week_counts(p_actor text, p_professional text default null) returns jsonb language plpgsql as $$
declare v_result jsonb; v_monday timestamptz:=current_setting('cita.test_week_monday')::timestamptz;
begin
 perform set_config('request.jwt.claim.sub',(select id::text from week_fixture where label=p_actor),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 select coalesce(jsonb_object_agg(c.local_date||' '||c.status,c.appointments),'{}') into v_result
 from public.agenda_week_counts((select id from week_fixture where label='business'),v_monday-interval '12 hours',v_monday+interval '6 days 11 hours',
  'America/Argentina/Buenos_Aires',(select id from week_fixture where label=p_professional)) c;
 execute 'reset role';
 return v_result;
end $$;

-- 1. The owner counts every appointment by local day and state; 01:30 UTC on Tuesday is Monday in Buenos Aires.
do $$
declare v_monday date:=(current_setting('cita.test_week_monday')::timestamptz at time zone 'America/Argentina/Buenos_Aires')::date; v_counts jsonb:=pg_temp.week_counts('owner');
begin
 if v_counts is distinct from jsonb_build_object(v_monday||' reserved',4,v_monday||' confirmed',1,v_monday||' cancelled',1,(v_monday+1)||' reschedule_requested',1) then
  raise exception 'TEST_OWNER_COUNTS %',v_counts;
 end if;
end $$;
select extensions.pass('the owner counts the week by local day and state, with the practice time zone');

-- 2. A professional counts only what their read rules show: their appointments and the joint one.
do $$
declare v_monday date:=(current_setting('cita.test_week_monday')::timestamptz at time zone 'America/Argentina/Buenos_Aires')::date; v_counts jsonb:=pg_temp.week_counts('professional');
begin
 if v_counts is distinct from jsonb_build_object(v_monday||' reserved',3,v_monday||' confirmed',1,(v_monday+1)||' reschedule_requested',1) then
  raise exception 'TEST_PROFESSIONAL_COUNTS %',v_counts;
 end if;
 if pg_temp.week_counts('stranger')<>'{}' then raise exception 'TEST_STRANGER_COUNTS %',pg_temp.week_counts('stranger'); end if;
end $$;
select extensions.pass('a professional counts only their readable appointments and a stranger counts nothing');

-- 3. The professional filter follows allocations, so a joint appointment counts for both professionals.
do $$
declare v_monday date:=(current_setting('cita.test_week_monday')::timestamptz at time zone 'America/Argentina/Buenos_Aires')::date;
 v_linked jsonb:=pg_temp.week_counts('owner','linked'); v_other jsonb:=pg_temp.week_counts('owner','other');
begin
 if v_linked is distinct from jsonb_build_object(v_monday||' reserved',3,v_monday||' confirmed',1,(v_monday+1)||' reschedule_requested',1)
  or v_other is distinct from jsonb_build_object(v_monday||' reserved',2,v_monday||' cancelled',1) then
  raise exception 'TEST_PROFESSIONAL_FILTER % %',v_linked,v_other;
 end if;
end $$;
select extensions.pass('the professional filter counts each appointment of the professional, joint ones included');

-- 4. Only a bounded week with a real time zone is counted.
select extensions.throws_ok(
 format('select * from public.agenda_week_counts(%L,now(),now()+interval ''9 days'',''America/Argentina/Buenos_Aires'')',(select id from week_fixture where label='business')),
 'P0001','AGENDA_WEEK_INVALID','a range longer than a week is refused');

-- 5. Signed-in users and the server can call it; anonymous callers cannot.
select extensions.ok(
 not has_function_privilege('anon','public.agenda_week_counts(uuid,timestamptz,timestamptz,text,uuid)','execute')
 and has_function_privilege('authenticated','public.agenda_week_counts(uuid,timestamptz,timestamptz,text,uuid)','execute'),
 'the weekly counts are not executable anonymously');

select * from extensions.finish();
rollback;

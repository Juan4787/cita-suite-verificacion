-- The visible change history of a patient is written in the same transaction as the
-- change it describes: a saved update cannot lose its history line, and a history line
-- that cannot be written undoes the update. Synthetic data only; everything is rolled back.
begin;
select extensions.plan(4);

create temporary table history_fixture(label text primary key, id uuid not null);

do $$
declare
 b uuid:=gen_random_uuid(); u_owner uuid:=gen_random_uuid(); u_pro uuid:=gen_random_uuid();
 p_own uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid(); x uuid;
begin
 insert into auth.users(id,email) select id,'change-history-'||id||'@example.test' from unnest(array[u_owner,u_pro]) id;
 insert into public.businesses(id,name,slug,industry,timezone) values(b,'Historial',b::text,'other','America/Argentina/Buenos_Aires');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values
  (b,u_owner,'owner','active',now()),(b,u_pro,'professional','active',now());
 insert into public.professionals(id,business_id,name) values(p_own,b,'Profesional propio'),(p_other,b,'Profesional ajeno');
 insert into public.professional_users(business_id,user_id,professional_id) values(b,u_pro,p_own);
 insert into public.patients(owner_id,business_id,full_name) values(u_owner,b,'Paciente original') returning id into x;
 insert into public.professional_patient_links(business_id,professional_id,patient_id,source,is_active,created_by)
  values(b,p_own,x,'manual',true,u_owner);
 insert into history_fixture values('business',b),('owner',u_owner),('pro',u_pro),('p_own',p_own),('p_other',p_other),('x',x);
end $$;

create function pg_temp.fid(p_label text) returns uuid language sql as $$ select id from history_fixture where label=p_label $$;
-- Saves the patient's name as the actor, with the history line the application describes.
create function pg_temp.save_name(p_actor text, p_name text, p_fields text[], p_professional uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', pg_temp.fid(p_actor)::text, true);
 perform public.update_patient_with_clinical_profile_safely(
  p_actor_id => pg_temp.fid(p_actor), p_business_id => pg_temp.fid('business'), p_patient_id => pg_temp.fid('x'),
  p_full_name => p_name, p_dni => null, p_phone => null, p_phone_raw => null, p_phone_e164 => null, p_email => null,
  p_birth_date => null, p_address => null, p_insurance => null, p_insurance_plan => null,
  p_changed_fields => p_fields,
  p_change_summary => case when cardinality(p_fields) > 0 then 'Se modificó: ' || array_to_string(p_fields, ', ') || '.' end,
  p_changed_by_professional_id => p_professional, p_changed_by_name => 'Autor sintético');
end $$;
create function pg_temp.history() returns text language sql as $$
 select coalesce(string_agg(summary || ' by ' || coalesce(changed_by_professional_id::text, 'owner'), ' | ' order by created_at), '')
 from public.patient_profile_change_events where patient_id = pg_temp.fid('x')
$$;

-- 1. A change and its history line commit together, attributed to the actor.
do $$
begin
 perform pg_temp.save_name('pro', 'Paciente renombrado', array['nombre'], pg_temp.fid('p_own'));
 if (select full_name from public.patients where id = pg_temp.fid('x')) <> 'Paciente renombrado'
  or pg_temp.history() <> 'Se modificó: nombre. by ' || pg_temp.fid('p_own') then
  raise exception 'TEST_CHANGE_WITHOUT_ITS_HISTORY %', pg_temp.history();
 end if;
end $$;
select extensions.pass('a change and its history line commit together');

-- 2. A save that changed nothing writes no history line.
do $$
begin
 perform pg_temp.save_name('owner', 'Paciente renombrado', '{}', null);
 if (select count(*) from public.patient_profile_change_events where patient_id = pg_temp.fid('x')) <> 1 then
  raise exception 'TEST_EMPTY_CHANGE_WROTE_HISTORY %', pg_temp.history();
 end if;
end $$;
select extensions.pass('a save without changes writes no history line');

-- 3. A history line attributed to someone else's professional profile is refused, and
-- the change it belonged to is undone with it.
do $$
begin
 begin
  perform pg_temp.save_name('pro', 'Paciente ajeno', array['nombre'], pg_temp.fid('p_other'));
  raise exception 'TEST_FOREIGN_AUTHOR_ACCEPTED';
 exception when others then
  if sqlerrm <> 'PATIENT_UPDATE_DENIED' then raise; end if;
 end;
 if (select full_name from public.patients where id = pg_temp.fid('x')) <> 'Paciente renombrado'
  or (select count(*) from public.patient_profile_change_events where patient_id = pg_temp.fid('x')) <> 1 then
  raise exception 'TEST_REFUSED_HISTORY_KEPT_THE_CHANGE %', pg_temp.history();
 end if;
end $$;
select extensions.pass('a history line that cannot be written undoes its change');

-- 4. Only the trusted backend runs it, as the previous signature.
select extensions.ok(
 has_function_privilege('service_role', 'public.update_patient_with_clinical_profile_safely(uuid,uuid,uuid,text,text,text,text,text,text,date,text,text,text,text[],text,uuid,text,boolean,text,text,text,timestamptz,timestamptz)', 'execute')
 and not has_function_privilege('authenticated', 'public.update_patient_with_clinical_profile_safely(uuid,uuid,uuid,text,text,text,text,text,text,date,text,text,text,text[],text,uuid,text,boolean,text,text,text,timestamptz,timestamptz)', 'execute')
 and not has_function_privilege('anon', 'public.update_patient_with_clinical_profile_safely(uuid,uuid,uuid,text,text,text,text,text,text,date,text,text,text,text[],text,uuid,text,boolean,text,text,text,timestamptz,timestamptz)', 'execute'),
 'only the trusted backend saves a patient with its history');

select * from extensions.finish();
rollback;

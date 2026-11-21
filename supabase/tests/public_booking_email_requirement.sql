-- The requirement applies to new public operations, not completed replay or
-- unrelated editing. All entry points retain the existing identity contracts.
begin;
select extensions.plan(12);
create temporary table booking_email_fixture(label text primary key,value text not null);
create function pg_temp.bev(label text) returns text language sql as $$select value from booking_email_fixture f where f.label=$1$$;
create function pg_temp.beid(label text) returns uuid language sql as $$select pg_temp.bev($1)::uuid$$;
create function pg_temp.becounts() returns jsonb language sql as $$select jsonb_build_array(
 (select count(*) from public.patients where business_id=pg_temp.beid('business')),
 (select count(*) from public.appointments where business_id=pg_temp.beid('business')),
 (select count(*) from public.appointment_management_states where business_id=pg_temp.beid('business')),
 (select count(*) from public.appointment_booking_contexts where business_id=pg_temp.beid('business')),
 (select count(*) from public.appointment_intake_submissions where business_id=pg_temp.beid('business')),
 (select count(*) from public.audit_logs where business_id=pg_temp.beid('business')),
 (select count(*) from private.appointment_email_events where business_id=pg_temp.beid('business')))$$;
do $$declare b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email) values(u,'booking-email-'||u||'@example.test');
 insert into public.businesses(id,name,slug,industry,timezone,public_booking_enabled,max_booking_days_ahead)
 values(b,'Synthetic public email',b::text,'other','UTC',true,90);
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,u,'owner','active',now());
 insert into public.services(id,business_id,name,duration_minutes,is_public) values(s,b,'Synthetic email service',30,true);
 insert into public.professionals(id,business_id,name,is_public) values(p,b,'Synthetic email professional',true);
 insert into public.professional_services(business_id,professional_id,service_id) values(b,p,s);
 insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes,is_active)
 select b,p,day,'08:00','18:00',30,0,true from generate_series(0,6) day;
 insert into public.booking_integrations(id,business_id,name,is_active,allowed_origins,allowed_service_ids,allowed_professional_ids)
 values(i,b,'Synthetic email integration',true,array['https://booking.example.test'],array[s],array[p]);
 insert into booking_email_fixture values('business',b::text),('owner',u::text),('service',s::text),('professional',p::text),('integration',i::text),('key',gen_random_uuid()::text);
 update public.appointment_email_policies set email_enabled=false where business_id=b;
end$$;
create function pg_temp.bebook(mode text,email text,key text default gen_random_uuid()::text,hour integer default 9,patient_name text default 'Synthetic Email Patient') returns jsonb
language plpgsql as $$declare result record; info jsonb; b uuid:=pg_temp.beid('business'); p uuid:=pg_temp.beid('professional'); s uuid:=pg_temp.beid('service');
 starts timestamptz:=date_trunc('day',now())+interval '25 days'+make_interval(hours=>hour); i uuid:=pg_temp.beid('integration'); rev bigint; availability bigint;
begin
 select revision into rev from public.booking_integrations where id=i;
 select booking_availability_revision into availability from public.businesses where id=b;
 if mode='direct' then
  select * into result from public.create_appointment_with_patient_identity(b,'public',null,patient_name,'3425048209','+5493425048209',email,
   false,null,s,array[p],starts,null,null,false,'public_booking','valid',false,key);
 elsif mode='integrated' then
  select * into result from public.create_integrated_public_appointment(i,rev,availability,patient_name,'3425048209','+5493425048209',email,
   s,array[p],starts,null,'valid','in_person','{}',key);
 elsif mode='information' then
  info:=public.get_public_patient_booking_schema(b,array[p],null);
  select * into result from public.create_public_booking_with_information(jsonb_build_object('business_id',b,'professional_ids',array[p],
   'service_id',s,'patient_name',patient_name,'patient_phone_raw','3425048209','patient_phone_e164','+5493425048209','patient_email',email,
   'starts_at',starts,'phone_status','valid','request_key',key,'schema_hash',info->>'hash','answers','{}'::jsonb,'price_quote_hash',''));
 else raise exception 'INVALID_EMAIL_FIXTURE_MODE'; end if;
 return to_jsonb(result);
end$$;
select extensions.ok((select require_email and not email_enabled from public.appointment_email_policies where business_id=pg_temp.beid('business')),'Required email remains enabled while deliveries are off');
select extensions.ok((pg_temp.bebook('direct',null,gen_random_uuid()::text,8,'Synthetic Unverified Sender Patient')->>'id') is not null,
 'AF1-002: without a verified sender, public booking does not block omitted email even if require_email=true');
select public.operator_set_business_email_sender(pg_temp.beid('business'),'booking-email-req.cita-suite.com.ar','verified');
do $$declare before jsonb:=pg_temp.becounts(); begin
 begin perform pg_temp.bebook('direct',null); raise exception 'EMAIL_REQUIREMENT_BYPASSED';
 exception when others then if sqlerrm is distinct from 'PUBLIC_PATIENT_EMAIL_REQUIRED' then raise; end if; end;
 if pg_temp.becounts() is distinct from before then raise exception 'MISSING_EMAIL_PARTIAL_CREATION'; end if;
end$$;
select extensions.pass('Direct SQL creation without email rolls back patient, appointment, authority, audit and events');
select extensions.throws_ok($$select pg_temp.bebook('direct','   ')$$,'P0001','PUBLIC_PATIENT_EMAIL_REQUIRED','Spaces do not complete required contact');
update public.appointment_email_policies set require_email=false where business_id=pg_temp.beid('business');
insert into booking_email_fixture values('optional-result',pg_temp.bebook('direct',null,pg_temp.bev('key'))::text);
select extensions.ok((pg_temp.bev('optional-result')::jsonb->>'id') is not null,'Optional public contact permits an omitted email');
update public.appointment_email_policies set require_email=true where business_id=pg_temp.beid('business');
select extensions.ok(pg_temp.bebook('direct',null,pg_temp.bev('key'))->>'id'=pg_temp.bev('optional-result')::jsonb->>'id','A completed creation is recovered after the email requirement changes');
update public.appointment_email_policies set require_email=false where business_id=pg_temp.beid('business');
do $$declare before jsonb:=pg_temp.becounts(); begin
 begin perform pg_temp.bebook('direct','wrong-address',gen_random_uuid()::text,10); raise exception 'INVALID_EMAIL_ACCEPTED';
 exception when others then if sqlerrm is distinct from 'PUBLIC_PATIENT_EMAIL_INVALID' then raise; end if; end;
 if pg_temp.becounts() is distinct from before then raise exception 'INVALID_EMAIL_PARTIAL_CREATION'; end if;
end$$;
select extensions.pass('Optional means absence is allowed; a malformed supplied address still rolls back everything');
insert into booking_email_fixture values('valid-result',pg_temp.bebook('direct',' Family+Turnos@Example.test ',gen_random_uuid()::text,11,'Synthetic Alias Patient')::text);
select extensions.is((select email from public.patients where id=(pg_temp.bev('valid-result')::jsonb->>'patient_id')::uuid),'Family+Turnos@Example.test','Only outer spaces are trimmed; aliases and case are preserved');
insert into booking_email_fixture values('family-result',pg_temp.bebook('direct','Family+Turnos@Example.test',gen_random_uuid()::text,12,'Synthetic Family Patient')::text);
select extensions.ok(pg_temp.bev('family-result')::jsonb->>'patient_id'<>pg_temp.bev('valid-result')::jsonb->>'patient_id','A shared email does not merge two people');
update public.appointment_email_policies set require_email=true where business_id=pg_temp.beid('business');
do $$declare before jsonb:=pg_temp.becounts(); begin
 begin perform pg_temp.bebook('integrated',null,gen_random_uuid()::text,13,'Synthetic Integrated Missing'); raise exception 'INTEGRATED_EMAIL_BYPASSED';
 exception when others then if sqlerrm is distinct from 'PUBLIC_PATIENT_EMAIL_REQUIRED' then raise; end if; end;
 if pg_temp.becounts() is distinct from before then raise exception 'INTEGRATED_EMAIL_PARTIAL_CREATION'; end if;
end$$;
select extensions.pass('Integrated creation cannot bypass the requirement or leave a partial booking context');
do $$declare before jsonb:=pg_temp.becounts(); begin
 begin perform pg_temp.bebook('information',null,gen_random_uuid()::text,14,'Synthetic Information Missing'); raise exception 'INFORMATION_EMAIL_BYPASSED';
 exception when others then if sqlerrm is distinct from 'PUBLIC_PATIENT_EMAIL_REQUIRED' then raise; end if; end;
 if pg_temp.becounts() is distinct from before then raise exception 'INFORMATION_EMAIL_PARTIAL_CREATION'; end if;
end$$;
select extensions.pass('The information entry point cannot leave an intake, patient or appointment without required email');
select extensions.ok(not has_function_privilege('anon','private.assert_public_booking_email(uuid,text)','EXECUTE')
 and not has_function_privilege('service_role','public.create_appointment_with_patient_identity_before_pricing(uuid,text,uuid,text,text,text,text,boolean,uuid,uuid,uuid[],timestamptz,text,uuid,boolean,text,text,boolean,text,boolean)','EXECUTE'),
 'The unvalidated core is not a separate API creation route');
select * from extensions.finish();
rollback;

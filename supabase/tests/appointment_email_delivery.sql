-- Email delivery contracts. Everything is synthetic and rolls back; no provider is contacted, so
-- this proves decisions and persistence, never that a message reached a mailbox.
begin;
select extensions.plan(37);
create temporary table mail_fixture(label text primary key,id uuid not null);
create function pg_temp.mid(label text) returns uuid language sql as $$select id from mail_fixture f where f.label=$1$$;
create function pg_temp.base() returns timestamptz language sql as $$select date_trunc('hour',clock_timestamp())$$;

-- Appointments use their own distant slots so no case depends on another one's time.
create function pg_temp.book(p_starts timestamptz,p_patient uuid default null,p_business text default 'business') returns uuid
language plpgsql as $$
declare v_id uuid:=gen_random_uuid(); v_business uuid:=pg_temp.mid(p_business); v_suffix text:=case when p_business='business' then '' else '2' end;
begin
 insert into public.appointments(id,business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
  status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 values(v_id,v_business,coalesce(p_patient,pg_temp.mid('patient'||v_suffix)),pg_temp.mid('service'||v_suffix),pg_temp.mid('professional'||v_suffix),
  p_starts,p_starts+interval '30 minutes',p_starts,p_starts+interval '30 minutes','reserved','manual','Synthetic service','Synthetic professional',30);
 return v_id;
end $$;
create function pg_temp.move(p_id uuid,p_starts timestamptz) returns void language sql as $$
 update public.appointments set starts_at=p_starts,ends_at=p_starts+interval '30 minutes',blocking_starts_at=p_starts,blocking_ends_at=p_starts+interval '30 minutes' where id=p_id
$$;
create function pg_temp.claim(p_now timestamptz default null,p_limit integer default 20) returns jsonb language sql as $$
 select public.claim_appointment_email_batch(p_limit,coalesce(p_now,clock_timestamp()))
$$;
create function pg_temp.settle(p_claim jsonb,p_outcome text default 'accepted',p_code text default null,p_now timestamptz default null) returns jsonb language sql as $$
 select public.record_appointment_email_results(coalesce((select jsonb_agg(jsonb_build_object('delivery_id',i->>'delivery_id','lease_token',i->>'lease_token',
  'outcome',p_outcome,'request_id','req-'||(i->>'delivery_id'),'code',p_code)) from jsonb_array_elements(p_claim->'items') i),'[]'::jsonb),p_now)
$$;
create function pg_temp.items_for(p_claim jsonb,p_id uuid) returns jsonb language sql as $$
 select coalesce(jsonb_agg(i),'[]'::jsonb) from jsonb_array_elements(p_claim->'items') i where i->'snapshot'->>'id'=p_id::text
$$;
create function pg_temp.state(p_id uuid,p_purpose text) returns text language sql as $$
 select string_agg(d.state||coalesce(':'||d.discard_reason,''),',' order by d.created_at,d.id) from private.appointment_email_deliveries d where d.appointment_id=p_id and d.purpose=p_purpose
$$;
-- Earlier cases leave accepted receipts; clearing keeps each case's claim about its own work.
create function pg_temp.drain() returns void language plpgsql as $$
declare c jsonb; begin
 update private.appointment_email_deliveries set state='discarded',discard_reason='test_cleared',lease_token=null,lease_expires_at=null where state in ('pending','retry','sending','uncertain');
 c:=pg_temp.claim(); perform pg_temp.settle(c);
 update private.appointment_email_deliveries set started_at=null;
end $$;

do $$ declare b uuid:=gen_random_uuid(); b2 uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); x uuid:=gen_random_uuid();
 p uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); bare uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); s2 uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); f2 uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email) select u,'mail-'||u||'@example.test' from unnest(array[o,r,x]) u;
 insert into public.businesses(id,name,slug,industry,timezone) values(b,'Synthetic mail practice',b::text,'other','UTC'),(b2,'Second mail practice',b2::text,'other','UTC');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id in (b,b2);
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,o,'owner','active',now()),(b,r,'reception','active',now()),(b2,x,'owner','active',now());
 insert into public.patients(id,business_id,owner_id,full_name,phone_e164,email) values
  (p,b,o,'Synthetic mail patient','+5493512345601','shared@example.test'),(bare,b,o,'Synthetic patient without mail','+5493512345602',null),
  (p2,b2,x,'Second practice patient','+5493512345603','shared@example.test');
 insert into public.services(id,business_id,name,duration_minutes) values(s,b,'Synthetic service',30),(s2,b2,'Synthetic service',30);
 insert into public.professionals(id,business_id,name) values(f,b,'Synthetic professional'),(f2,b2,'Synthetic professional');
 insert into public.professional_services(business_id,professional_id,service_id) values(b,f,s),(b2,f2,s2);
 insert into mail_fixture values('business',b),('business2',b2),('owner',o),('reception',r),('outsider',x),('patient',p),('patient2',p2),('bare',bare),('service',s),('service2',s2),('professional',f),('professional2',f2);
end $$;

select extensions.ok(has_function_privilege('service_role','public.claim_appointment_email_batch(integer,timestamptz)','EXECUTE')
 and not exists(select 1 from unnest(array['anon','authenticated']) role_name,
  unnest(array['public.claim_appointment_email_batch(integer,timestamptz)','public.record_appointment_email_results(jsonb,timestamptz)','public.record_email_provider_event(text,text,text,timestamptz)',
   'public.apply_email_unsubscribe(text)','public.get_email_unsubscribe(text)','public.operator_set_business_email_sender(uuid,text,text,text,text)']) signature
  where has_function_privilege(role_name,signature,'EXECUTE'))
 and not exists(select 1 from unnest(array['anon','authenticated','service_role']) role_name,
  unnest(array['private.appointment_email_deliveries','private.email_suppressions','private.email_unsubscribe_tokens','private.business_email_senders']) relation
  where has_table_privilege(role_name,relation,'SELECT,INSERT,UPDATE,DELETE')),
 '1. Work, recipients and senders are reachable only through the backend commands');

select pg_temp.book(pg_temp.base()+interval '40 days');
select extensions.ok(not (pg_temp.claim()->>'enabled')::boolean and not exists(select 1 from private.appointment_email_events where business_id=pg_temp.mid('business')),
 '2. Installation sends nothing: with the producer off no event exists and claiming returns nothing');

update private.appointment_management_runtime set email_producer_enabled=true;
select extensions.ok((select email_producer_enabled_at is not null from private.appointment_management_runtime),'3. Turning the producer on records when, so nothing earlier is treated as new');

insert into mail_fixture select 'a1',pg_temp.book(pg_temp.base()+interval '100 hours');
select extensions.ok(jsonb_array_length(pg_temp.claim()->'items')=0 and pg_temp.state(pg_temp.mid('a1'),'booking_receipt')='pending',
 '4. Enabled preference without a prepared sender keeps the receipt pending and sends nothing');

select extensions.throws_ok($$select public.operator_set_business_email_sender(pg_temp.mid('business'),'avisos.cita-suite.com.ar','verified')$$,'23514',null,'5a. Infrastructure names cannot become a practice sender');
select extensions.throws_ok($$select public.operator_set_business_email_sender(pg_temp.mid('business'),'consultorio.ejemplo.com','verified')$$,'23514',null,'5b. Only a subdomain of the product domain is accepted');
select public.operator_set_business_email_sender(pg_temp.mid('business'),'consultorio-prueba.cita-suite.com.ar','verified','domain-key');
select extensions.ok((select sender_verified from public.appointment_email_policies where business_id=pg_temp.mid('business')),'6. A verified domain is ready without a reply contact: these emails are not answered (plan 12.35)');
select public.operator_set_business_email_sender(pg_temp.mid('business'),'consultorio-prueba.cita-suite.com.ar','verified',null,'contacto@example.test');
select public.operator_set_business_email_sender(pg_temp.mid('business2'),'segundo-consultorio.cita-suite.com.ar','verified');
select extensions.ok((select sender_verified from public.appointment_email_policies where business_id=pg_temp.mid('business')),'7. Readiness is mirrored to the preference row without a second activation');

create temporary table mail_claim(label text primary key,value jsonb not null);
insert into mail_claim select 'first',pg_temp.claim();
select extensions.ok((select jsonb_array_length(value->'items')=1 and value#>>'{items,0,recipient}'='shared@example.test'
  and value#>>'{items,0,sender,from_address}'='turnos@consultorio-prueba.cita-suite.com.ar' and value#>>'{items,0,sender,reply_to}'='contacto@example.test'
  and value#>>'{items,0,purpose}'='booking_receipt' from mail_claim where label='first')
 and (public.resolve_appointment_management_access((select value#>>'{items,0,token}' from mail_claim where label='first'),false)->>'appointment_id')::uuid=pg_temp.mid('a1')
 and pg_temp.state(pg_temp.mid('a1'),'booking_receipt')='sending',
 '8. Claiming returns the current recipient, the practice identity and a working management link');
select extensions.ok(jsonb_array_length(pg_temp.claim()->'items')=0,'9. A claimed message cannot be claimed twice');
select pg_temp.settle((select value from mail_claim where label='first'));
select extensions.ok(pg_temp.state(pg_temp.mid('a1'),'booking_receipt')='accepted' and (pg_temp.settle((select value from mail_claim where label='first'))->>'ignored')::int=1,
 '10. A repeated result is ignored: it no longer holds the lease');

select pg_temp.drain();
insert into mail_fixture select 'a2',pg_temp.book(pg_temp.base()+interval '200 hours');
select pg_temp.settle(pg_temp.claim());
insert into mail_claim select 'at-due',pg_temp.claim(pg_temp.base()+interval '128 hours');
select extensions.ok((select jsonb_array_length(pg_temp.items_for(value,pg_temp.mid('a2')))=1 and pg_temp.items_for(value,pg_temp.mid('a2'))#>>'{0,purpose}'='reminder_72h' from mail_claim where label='at-due'),
 '11. RM01: the 72 hour reminder appears exactly when due');
select pg_temp.settle((select value from mail_claim where label='at-due'));
select extensions.ok(jsonb_array_length(pg_temp.items_for(pg_temp.claim(pg_temp.base()+interval '128 hours 5 minutes'),pg_temp.mid('a2')))=0,'12. The reminder of one time is owed once');

select pg_temp.move(pg_temp.mid('a2'),pg_temp.base()+interval '224 hours');
insert into mail_claim select 'moved',pg_temp.claim();
select pg_temp.settle((select value from mail_claim where label='moved'));
insert into mail_claim select 'moved-due',pg_temp.claim(pg_temp.base()+interval '152 hours');
select extensions.ok((select pg_temp.items_for(value,pg_temp.mid('a2'))#>>'{0,purpose}'='reschedule_receipt' from mail_claim where label='moved')
 and (select pg_temp.items_for(value,pg_temp.mid('a2'))#>>'{0,purpose}'='reminder_72h' from mail_claim where label='moved-due')
 and pg_temp.state(pg_temp.mid('a2'),'reminder_72h')='accepted,sending',
 '13. RM04: moving owes a new receipt and the duplicate guard does not swallow the reminder of the new time');
select pg_temp.drain();

insert into mail_fixture select 'a3',pg_temp.book(pg_temp.base()+interval '300 hours');
select pg_temp.move(pg_temp.mid('a3'),pg_temp.base()+interval '310 hours');
insert into mail_claim select 'superseded',pg_temp.claim();
select extensions.ok(pg_temp.state(pg_temp.mid('a3'),'booking_receipt')='discarded:superseded_schedule'
 and (select pg_temp.items_for(value,pg_temp.mid('a3'))#>>'{0,purpose}'='reschedule_receipt' from mail_claim where label='superseded')
 and (select (pg_temp.items_for(value,pg_temp.mid('a3'))#>>'{0,snapshot,starts_at}')::timestamptz=pg_temp.base()+interval '310 hours' from mail_claim where label='superseded'),
 '14. RM11: a receipt of an old time is discarded with its reason and only the current time goes out');
select pg_temp.settle((select value from mail_claim where label='superseded'));

insert into mail_fixture select 'a4',pg_temp.book(pg_temp.base()+interval '400 hours');
update public.appointments set status='cancelled',cancelled_at=clock_timestamp() where id=pg_temp.mid('a4');
insert into mail_claim select 'cancelled',pg_temp.claim();
select extensions.ok(pg_temp.state(pg_temp.mid('a4'),'booking_receipt')='discarded:appointment_cancelled'
 and (select jsonb_array_length(pg_temp.items_for(value,pg_temp.mid('a4')))=1 and pg_temp.items_for(value,pg_temp.mid('a4'))#>>'{0,purpose}'='cancellation_receipt'
  and pg_temp.items_for(value,pg_temp.mid('a4'))->0->'token'='null'::jsonb and not (pg_temp.items_for(value,pg_temp.mid('a4'))#>>'{0,snapshot,can_cancel}')::boolean
  and not (pg_temp.items_for(value,pg_temp.mid('a4'))#>>'{0,snapshot,can_reschedule}')::boolean from mail_claim where label='cancelled'),
 '15. A cancelled appointment gets its receipt with no management link and no cancel or reschedule');
select pg_temp.settle((select value from mail_claim where label='cancelled'));

insert into mail_fixture select 'a5',pg_temp.book(pg_temp.base()+interval '500 hours');
update public.patients set email='nuevo@example.test' where id=pg_temp.mid('patient');
insert into mail_claim select 'corrected',pg_temp.claim();
select extensions.ok((select pg_temp.items_for(value,pg_temp.mid('a5'))#>>'{0,recipient}'='nuevo@example.test' from mail_claim where label='corrected'),
 '16. EM07: a pending message goes to the corrected address, not to the one present when it was created');
select pg_temp.settle((select value from mail_claim where label='corrected'));

insert into mail_fixture select 'a6',pg_temp.book(pg_temp.base()+interval '600 hours',pg_temp.mid('bare'));
select pg_temp.claim();
select extensions.is(pg_temp.state(pg_temp.mid('a6'),'booking_receipt'),'discarded:no_recipient','17. EM09: no address means no message and the appointment is untouched');
update public.patients set email='agregado@example.test' where id=pg_temp.mid('bare');
insert into mail_claim select 'added',pg_temp.claim();
select extensions.ok((select pg_temp.items_for(value,pg_temp.mid('a6'))#>>'{0,recipient}'='agregado@example.test' from mail_claim where label='added')
 and not exists(select 1 from private.patient_email_contact_events where patient_id=pg_temp.mid('bare') and processed_at is null),
 '18. EM08: an address added later owes the current receipt once');
select pg_temp.settle((select value from mail_claim where label='added'));

insert into mail_fixture select 'a7',pg_temp.book(pg_temp.base()+interval '700 hours');
insert into mail_claim select 'before-unsub',pg_temp.claim();
select pg_temp.settle((select value from mail_claim where label='before-unsub'));
select extensions.ok((select (public.get_email_unsubscribe(value#>>'{items,0,unsubscribe_token}')->>'unsubscribed')='false' from mail_claim where label='before-unsub')
 and not exists(select 1 from private.email_suppressions),'19. AC02: reading the unsubscribe link changes nothing');
select public.apply_email_unsubscribe((select value#>>'{items,0,unsubscribe_token}' from mail_claim where label='before-unsub'));
select public.apply_email_unsubscribe((select value#>>'{items,0,unsubscribe_token}' from mail_claim where label='before-unsub'));
insert into mail_fixture select 'a8',pg_temp.book(pg_temp.base()+interval '800 hours');
update public.patients set email='nuevo@example.test' where id=pg_temp.mid('patient2');
insert into mail_fixture select 'b1',pg_temp.book(pg_temp.base()+interval '810 hours',null,'business2');
insert into mail_claim select 'after-unsub',pg_temp.claim();
select extensions.ok(pg_temp.state(pg_temp.mid('a8'),'booking_receipt')='discarded:suppressed'
 and (select count(*)=1 from private.email_suppressions)
 and (select pg_temp.items_for(value,pg_temp.mid('b1'))#>>'{0,sender,from_address}'='turnos@segundo-consultorio.cita-suite.com.ar' from mail_claim where label='after-unsub'),
 '20. EM10/ZH13: a removal applies to that practice and address only, and repeating it changes nothing');
select extensions.ok((select pg_temp.items_for(value,pg_temp.mid('b1'))#>>'{0,sender,reply_to}'='turnos@segundo-consultorio.cita-suite.com.ar' from mail_claim where label='after-unsub'),
 '20b. A practice with no reply contact sends too, and the claim names its sending address where an earlier app expects a reply address');
select pg_temp.settle((select value from mail_claim where label='after-unsub'));
delete from private.email_suppressions;

insert into mail_fixture select 'a9',pg_temp.book(pg_temp.base()+interval '900 hours');
insert into mail_claim select 'lost',pg_temp.claim();
select pg_temp.claim(clock_timestamp()+interval '11 minutes');
select extensions.ok(pg_temp.state(pg_temp.mid('a9'),'booking_receipt')='uncertain'
 and jsonb_array_length(pg_temp.items_for(pg_temp.claim(clock_timestamp()+interval '2 hours'),pg_temp.mid('a9')))=0,
 '21. ZH07: a claim that ended without a result becomes uncertain and is never resent by itself');
select extensions.ok((public.record_email_provider_event('wh-1',(select value#>>'{items,0,delivery_id}' from mail_claim where label='lost'),'delivered')->>'outcome')='delivered'
 and pg_temp.state(pg_temp.mid('a9'),'booking_receipt')='delivered'
 and (public.record_email_provider_event('wh-1',(select value#>>'{items,0,delivery_id}' from mail_claim where label='lost'),'hard_bounce')->>'duplicate')='true'
 and pg_temp.state(pg_temp.mid('a9'),'booking_receipt')='delivered',
 '22. ZH10: provider evidence resolves the uncertainty, and a repeated notification id changes nothing');
select public.record_email_provider_event('wh-2',(select value#>>'{items,0,delivery_id}' from mail_claim where label='lost'),'hard_bounce');
select public.record_email_provider_event('wh-3',(select value#>>'{items,0,delivery_id}' from mail_claim where label='lost'),'delivered');
select extensions.ok(pg_temp.state(pg_temp.mid('a9'),'booking_receipt')='bounced'
 and (select outcome='ignored' from private.email_provider_events where webhook_request_id='wh-3')
 and exists(select 1 from private.email_suppressions where reason='hard_bounce' and email_normalized='nuevo@example.test'),
 '23. ZH08: a bounce stops that address and a late delivered does not undo it');
delete from private.email_suppressions;
select extensions.is(public.record_email_provider_event('wh-4','not-a-reference','delivered')->>'outcome','unknown_reference','24. ZH10: an unknown reference is acknowledged and changes nothing');

select pg_temp.drain();
insert into mail_fixture select 'a10',pg_temp.book(pg_temp.base()+interval '1000 hours');
select pg_temp.settle(pg_temp.claim(),'retry','http_429');
select extensions.ok(pg_temp.state(pg_temp.mid('a10'),'booking_receipt')='retry'
 and jsonb_array_length(pg_temp.items_for(pg_temp.claim(),pg_temp.mid('a10')))=0
 and jsonb_array_length(pg_temp.items_for(pg_temp.claim(clock_timestamp()+interval '6 minutes'),pg_temp.mid('a10')))=1,
 '25. ZH06: a known temporary failure waits its backoff and then retries');
select pg_temp.drain();

insert into mail_fixture select 'a11',pg_temp.book(pg_temp.base()+interval '1100 hours');
select pg_temp.settle(pg_temp.claim(),'pause','SERR_157');
select extensions.ok((pg_temp.claim()->>'paused')::boolean and pg_temp.state(pg_temp.mid('a11'),'booking_receipt')='retry'
 and (select attempts=0 and started_at is null from private.appointment_email_deliveries where appointment_id=pg_temp.mid('a11') and purpose='booking_receipt'),
 '26. ZH12: a rejected key pauses every run, and the refused attempt neither counts nor consumes quota');
update private.appointment_management_runtime set email_paused_until=null,email_pause_reason=null;

select pg_temp.drain();
insert into mail_fixture select 'a12',pg_temp.book(pg_temp.base()+interval '1200 hours');
select pg_temp.settle(pg_temp.claim(),'sender_rejected','SM_111');
select extensions.ok((select domain_state='failed' and last_error_code='SM_111' from private.business_email_senders where business_id=pg_temp.mid('business'))
 and not (select sender_verified from public.appointment_email_policies where business_id=pg_temp.mid('business'))
 and pg_temp.state(pg_temp.mid('a12'),'booking_receipt')='retry',
 '27. ZH12: a sender the provider refuses stops being ready, visibly, and the message waits');
select public.operator_set_business_email_sender(pg_temp.mid('business'),'consultorio-prueba.cita-suite.com.ar','verified');

select pg_temp.drain();
update private.appointment_management_runtime set email_daily_limit=11,email_daily_reserve=10;
insert into mail_fixture select 'a13',pg_temp.book(pg_temp.base()+interval '1300 hours');
insert into mail_fixture select 'a14',pg_temp.book(pg_temp.base()+interval '1400 hours');
insert into mail_claim select 'quota',pg_temp.claim();
select extensions.ok((select jsonb_array_length(value->'items')=1 from mail_claim where label='quota')
 and (select string_agg(state,',' order by state) from private.appointment_email_deliveries where appointment_id in (pg_temp.mid('a13'),pg_temp.mid('a14')))='pending,sending',
 '28. ZH03: our own durable count keeps the reserve; the rest waits without being lost');
select pg_temp.settle((select value from mail_claim where label='quota'));
update private.appointment_management_runtime set email_daily_limit=100,email_daily_reserve=10;
select pg_temp.drain();

insert into mail_fixture select 'a15',pg_temp.book(pg_temp.base()+interval '76 hours');
select pg_temp.settle(pg_temp.claim());
update public.appointment_management_states set schedule_changed_at=pg_temp.base()+interval '4 hours' where appointment_id=pg_temp.mid('a15');
select extensions.ok(jsonb_array_length(pg_temp.items_for(pg_temp.claim(pg_temp.base()+interval '4 hours'),pg_temp.mid('a15')))=0
 and pg_temp.state(pg_temp.mid('a15'),'reminder_72h') is null,
 '29. RM02: a time established exactly at the boundary owes its receipt, not a reminder');
update public.appointment_management_states set schedule_changed_at=pg_temp.base() where appointment_id=pg_temp.mid('a15');
select extensions.ok(jsonb_array_length(pg_temp.items_for(pg_temp.claim(pg_temp.base()+interval '4 hours 31 minutes'),pg_temp.mid('a15')))=0
 and pg_temp.state(pg_temp.mid('a15'),'reminder_72h') is null,'30. RM10: a reminder past its recovery window is not sent');
select pg_temp.drain();

select set_config('request.jwt.claim.sub',pg_temp.mid('outsider')::text,true);
select extensions.throws_ok($$select public.list_appointment_email_deliveries(pg_temp.mid('business'),pg_temp.mid('a1'))$$,'P0001','APPOINTMENT_MANAGEMENT_FORBIDDEN','31. Another practice cannot read this one''s messages');
select set_config('request.jwt.claim.sub',pg_temp.mid('reception')::text,true);
select extensions.ok(jsonb_array_length(public.list_appointment_email_deliveries(pg_temp.mid('business'),pg_temp.mid('a1')))>=1
 and not public.list_appointment_email_deliveries(pg_temp.mid('business'),pg_temp.mid('a1'))::text ~ 'req-',
 '32. The practice sees what happened, without provider identifiers');
select set_config('request.jwt.claim.sub','',true);

-- Reassigning an appointment must not carry the previous recipient (EM11).
insert into mail_fixture select 'a16',pg_temp.book(pg_temp.base()+interval '1600 hours');
select set_config('request.jwt.claim.sub',pg_temp.mid('owner')::text,true);
select public.reassign_appointment_patient_safely(pg_temp.mid('business'),pg_temp.mid('a16'),pg_temp.mid('bare'),pg_temp.mid('owner'),'Synthetic identity correction');
select set_config('request.jwt.claim.sub','',true);
insert into mail_claim select 'reassigned',pg_temp.claim();
select extensions.ok((select pg_temp.items_for(value,pg_temp.mid('a16'))#>>'{0,recipient}'='agregado@example.test' from mail_claim where label='reassigned'),
 '33. EM11: a reassigned appointment goes to the person it belongs to now');
select pg_temp.settle((select value from mail_claim where label='reassigned'));

select public.run_appointment_email_retention(clock_timestamp()+interval '181 days');
select extensions.ok((select count(*)=0 from private.appointment_management_capabilities where business_id=pg_temp.mid('business') and expires_at<clock_timestamp()+interval '151 days')
 and exists(select 1 from private.appointment_email_deliveries where business_id=pg_temp.mid('business') and recipient_email is null and state='accepted'),
 '34. Retention removes expired link hashes and old recipients while the record of the message stays');

delete from public.appointments where business_id=pg_temp.mid('business');
select extensions.ok(not exists(select 1 from private.appointment_email_deliveries where business_id=pg_temp.mid('business')),'35. Removing an appointment removes its messages');
select * from extensions.finish();
rollback;

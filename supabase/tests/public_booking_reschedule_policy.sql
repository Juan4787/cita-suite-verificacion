-- Initial disclosure is part of creation, never a second financial operation.
begin;
select extensions.plan(20);
create temporary table booking_policy_fixture(label text primary key,value text not null);
create function pg_temp.bpv(label text) returns text language sql as $$select value from booking_policy_fixture where booking_policy_fixture.label=$1$$;
create function pg_temp.bpid(label text) returns uuid language sql as $$select pg_temp.bpv($1)::uuid$$;
create function pg_temp.bpterms() returns jsonb language sql as $$
 select jsonb_build_object('schema_version',1,'policy_revision',revision,
  'require_deposit_on_reschedule',require_deposit_on_reschedule,'previous_deposit_disposition',previous_deposit_disposition)
 from public.appointment_email_policies where business_id=pg_temp.bpid('business')
$$;
create function pg_temp.bpheaders(terms jsonb) returns void language plpgsql as $$begin
 perform set_config('request.headers',case when terms is null then '{}' else
  jsonb_build_object('x-cita-reschedule-policy',terms::text)::text end,true);
end
$$;
create function pg_temp.bpcounts() returns jsonb language sql as $$select jsonb_build_array(
 (select count(*) from public.patients where business_id=pg_temp.bpid('business')),
 (select count(*) from public.appointments where business_id=pg_temp.bpid('business')),
 (select count(*) from public.appointment_management_states where business_id=pg_temp.bpid('business')),
 (select count(*) from public.appointment_deposits where business_id=pg_temp.bpid('business')),
 (select count(*) from public.appointment_deposit_requirements where business_id=pg_temp.bpid('business')),
 (select count(*) from public.appointment_deposit_events where business_id=pg_temp.bpid('business')),
 (select count(*) from public.appointment_booking_contexts where business_id=pg_temp.bpid('business')),
 (select count(*) from public.appointment_intake_submissions where business_id=pg_temp.bpid('business')),
 (select count(*) from public.audit_logs where business_id=pg_temp.bpid('business')),
 (select count(*) from private.appointment_email_events where business_id=pg_temp.bpid('business')),
 (select count(*) from private.public_booking_email_contacts where business_id=pg_temp.bpid('business')))$$;
do $$declare b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email) values(u,'informed-booking-'||u||'@example.test');
 insert into public.businesses(id,name,slug,industry,timezone,public_booking_enabled,max_booking_days_ahead)
 values(b,'Synthetic informed booking',b::text,'other','UTC',true,90);
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,u,'owner','active',now());
 insert into public.services(id,business_id,name,duration_minutes,is_public) values(s,b,'Synthetic informed service',30,true);
 insert into public.professionals(id,business_id,name,is_public) values(p,b,'Synthetic informed professional',true);
 insert into public.professional_services(business_id,professional_id,service_id) values(b,p,s);
 insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes,is_active)
 select b,p,day,'08:00','18:00',30,0,true from generate_series(0,6) day;
 insert into public.booking_integrations(id,business_id,name,is_active,allowed_origins,allowed_service_ids,allowed_professional_ids)
 values(i,b,'Synthetic informed integration',true,array['https://booking.example.test'],array[s],array[p]);
 insert into booking_policy_fixture values('business',b::text),('owner',u::text),('service',s::text),('professional',p::text),('integration',i::text),('key',gen_random_uuid()::text);
 update private.deposit_automation set enabled=true;
 update private.appointment_management_runtime set email_producer_enabled=true;
 perform public.operator_set_business_email_sender(b,'reschedule-policy.cita-suite.com.ar','verified');
 insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,transfer_details)
 values(b,true,true,'fixed',40000,'Synthetic fixture transfer details');
end$$;
create function pg_temp.bpbook(mode text default 'direct',key text default gen_random_uuid()::text) returns jsonb language plpgsql as $$
declare result record; info jsonb; b uuid:=pg_temp.bpid('business'); p uuid:=pg_temp.bpid('professional'); s uuid:=pg_temp.bpid('service');
 n integer:=(select count(*)::integer from public.appointments where business_id=b);
 starts timestamptz:=date_trunc('day',now())+make_interval(days=>15+n,hours=>9);
 i uuid:=pg_temp.bpid('integration'); rev bigint; availability bigint; patient_name text:='Synthetic Informed '||key;
 phone text:='+549342'||lpad((5000000+n)::text,7,'0');
begin
 -- Completed replay must retain exactly the original identity payload.
 if key=pg_temp.bpv('key') and exists(select 1 from booking_policy_fixture where label='replay') then
  starts:=(pg_temp.bpv('replay')::jsonb->>'starts_at')::timestamptz; phone:='+5493425000000';
 end if;
 select revision into rev from public.booking_integrations where id=i;
 select booking_availability_revision into availability from public.businesses where id=b;
 if mode='direct' then
  select * into result from public.create_appointment_with_patient_identity(b,'public',null,patient_name,phone,phone,'informed@example.test',
   false,null,s,array[p],starts,null,null,false,'public_booking','valid',false,key);
 elsif mode='integrated' then
  select * into result from public.create_integrated_public_appointment(i,rev,availability,patient_name,phone,phone,'informed@example.test',
   s,array[p],starts,null,'valid','in_person','{}',key);
 elsif mode='information' then
  info:=public.get_public_patient_booking_schema(b,array[p],null);
  select * into result from public.create_public_booking_with_information(jsonb_build_object('business_id',b,'professional_ids',array[p],
   'service_id',s,'patient_name',patient_name,'patient_phone_raw',phone,'patient_phone_e164',phone,'patient_email','informed@example.test',
   'starts_at',starts,'phone_status','valid','request_key',key,'schema_hash',info->>'hash','answers','{}'::jsonb,'price_quote_hash',''));
 else raise exception 'INVALID_INFORMED_FIXTURE_MODE'; end if;
 return to_jsonb(result);
end$$;
create function pg_temp.bpreject(mode text,expected text) returns void language plpgsql as $$declare before jsonb:=pg_temp.bpcounts(); begin
 begin perform pg_temp.bpbook(mode); raise exception 'UNINFORMED_BOOKING_ACCEPTED';
 exception when others then if sqlerrm is distinct from expected then raise; end if; end;
 if pg_temp.bpcounts() is distinct from before then raise exception 'PARTIAL_INFORMED_BOOKING'; end if;
end$$;

-- Before enabling the new route, legacy callers keep their old contract.
update private.appointment_management_runtime set reschedule_enabled=false;
select pg_temp.bpheaders(null);
insert into booking_policy_fixture values('replay',pg_temp.bpbook('direct',pg_temp.bpv('key'))::text);
select extensions.ok((select not terms_acknowledged and not require_deposit_on_reschedule and previous_deposit_disposition='credit'
 from public.appointment_management_states where appointment_id=(pg_temp.bpv('replay')::jsonb->>'id')::uuid),
 '1. An old caller while paused keeps an uninformed booking without new penalties');
update private.appointment_management_runtime set reschedule_enabled=true;
select pg_temp.bpreject('direct','RESCHEDULE_POLICY_TERMS_CHANGED');
select extensions.pass('2. Once enabled, a missing public summary rolls back all eleven creation projections');
select pg_temp.bpreject('integrated','RESCHEDULE_POLICY_TERMS_CHANGED');
select extensions.pass('3. Integrated creation cannot bypass informed policy or leave a partial booking context');
select pg_temp.bpreject('information','RESCHEDULE_POLICY_TERMS_CHANGED');
select extensions.pass('4. Information creation cannot leave a partial intake without informed terms');
do $$declare before jsonb:=pg_temp.bpcounts(); r jsonb; begin
 r:=pg_temp.bpbook('direct',pg_temp.bpv('key'));
 if r->>'id' is distinct from pg_temp.bpv('replay')::jsonb->>'id' or pg_temp.bpcounts() is distinct from before then raise exception 'REPLAY_REENROLLED_OR_DUPLICATED'; end if;
end$$;
select extensions.pass('5. Completed replay survives feature activation with no adoption, money, audit or event changes');

-- All four economic combinations are real creations, not direct state updates.
do $$declare required boolean; disposition text; result jsonb; state public.appointment_management_states; terms jsonb; begin
 foreach required in array array[true,false] loop
  foreach disposition in array array['forfeit','credit'] loop
   update public.appointment_email_policies set require_deposit_on_reschedule=required,previous_deposit_disposition=disposition,revision=revision+1 where business_id=pg_temp.bpid('business');
   terms:=pg_temp.bpterms(); perform pg_temp.bpheaders(terms); result:=pg_temp.bpbook();
   select * into state from public.appointment_management_states where appointment_id=(result->>'id')::uuid;
   if not state.terms_acknowledged or state.require_deposit_on_reschedule is distinct from required or state.previous_deposit_disposition is distinct from disposition
    or state.accepted_at is null or state.accepted_policy_revision is distinct from (terms->>'policy_revision')::bigint
    or state.terms_snapshot->'disclosed' is distinct from terms or state.terms_snapshot->'effective' is distinct from terms then raise exception 'WRONG_INITIAL_POLICY_SNAPSHOT'; end if;
   if (select count(*) from public.audit_logs where entity_id=state.appointment_id and action='appointment.reschedule_policy_informed' and user_id is null)<>1 then raise exception 'INFORMED_AUDIT_MISSING'; end if;
   if (select count(*) from public.appointment_deposit_requirements where appointment_id=state.appointment_id and is_current and status='pending' and amount=40000)<>1
    or (select status from public.appointments where id=state.appointment_id)<>'reserved' then raise exception 'INITIAL_BOOKING_MONEY_CHANGED'; end if;
   if (select count(*) from private.appointment_email_events where appointment_id=state.appointment_id and purpose='booking_receipt')<>1 then raise exception 'INFORMED_BOOKING_EVENT_MISSING'; end if;
  end loop;
 end loop;
end$$;
select extensions.pass('6. Four combinations store disclosed/effective rules and one audit with one unpaid obligation, without pretending payment');
do $$declare mode text; result jsonb; begin
 foreach mode in array array['integrated','information'] loop
  perform pg_temp.bpheaders(pg_temp.bpterms()); result:=pg_temp.bpbook(mode);
  if not (select terms_acknowledged from public.appointment_management_states where appointment_id=(result->>'id')::uuid) then raise exception 'ENTRY_POINT_DROPPED_POLICY'; end if;
 end loop;
end$$;
select extensions.pass('7. Integrated and information entry points preserve the same disclosure header');

-- Strictness is semantic: presentation-only changes and relaxations are safe.
insert into booking_policy_fixture values('shown',pg_temp.bpterms()::text);
update public.appointment_email_policies set show_cancel=false,revision=revision+1 where business_id=pg_temp.bpid('business');
select pg_temp.bpheaders(pg_temp.bpv('shown')::jsonb);
insert into booking_policy_fixture values('presentation',pg_temp.bpbook()::text);
select extensions.ok((select accepted_policy_revision=(select revision from public.appointment_email_policies where business_id=pg_temp.bpid('business'))
 from public.appointment_management_states where appointment_id=(pg_temp.bpv('presentation')::jsonb->>'id')::uuid),
 '8. A changed presentation revision does not manufacture a financial conflict');
update public.appointment_email_policies set require_deposit_on_reschedule=true,previous_deposit_disposition='forfeit',revision=revision+1 where business_id=pg_temp.bpid('business');
select pg_temp.bpheaders(pg_temp.bpterms());
update public.appointment_email_policies set require_deposit_on_reschedule=false,previous_deposit_disposition='credit',revision=revision+1 where business_id=pg_temp.bpid('business');
insert into booking_policy_fixture values('relaxed',pg_temp.bpbook()::text);
select extensions.ok((select terms_acknowledged and not require_deposit_on_reschedule and previous_deposit_disposition='credit'
 and terms_snapshot->'disclosed'->>'previous_deposit_disposition'='forfeit' and terms_snapshot->'effective'->>'previous_deposit_disposition'='credit'
 from public.appointment_management_states where appointment_id=(pg_temp.bpv('relaxed')::jsonb->>'id')::uuid),
 '9. Relaxation records both what was shown and the effective cheaper rules');
select pg_temp.bpheaders(pg_temp.bpterms());
update public.appointment_email_policies set require_deposit_on_reschedule=true,revision=revision+1 where business_id=pg_temp.bpid('business');
select pg_temp.bpreject('direct','RESCHEDULE_POLICY_TERMS_CHANGED');
select extensions.pass('10. A newly required advance rejects a stale summary with no partial state');
select pg_temp.bpheaders(pg_temp.bpterms());
update public.appointment_email_policies set previous_deposit_disposition='forfeit',revision=revision+1 where business_id=pg_temp.bpid('business');
select pg_temp.bpreject('direct','RESCHEDULE_POLICY_TERMS_CHANGED');
select extensions.pass('11. Newly forfeited credit rejects the stale summary even when another advance was already disclosed');
select pg_temp.bpheaders(pg_temp.bpterms()||jsonb_build_object('policy_revision',9007199254740991));
select pg_temp.bpreject('direct','RESCHEDULE_POLICY_TERMS_CHANGED');
select extensions.pass('12. A claimed future revision is never accepted as informed policy');
do $$declare invalid jsonb; begin
 foreach invalid in array array['null'::jsonb,'[]'::jsonb,'{}'::jsonb,pg_temp.bpterms()||'{"policy_revision":0}',
  pg_temp.bpterms()||'{"policy_revision":1.5}',pg_temp.bpterms()||'{"policy_revision":9007199254740992}',
  pg_temp.bpterms()||'{"require_deposit_on_reschedule":"true"}',pg_temp.bpterms()||'{"previous_deposit_disposition":"unknown"}',
  pg_temp.bpterms()||'{"schema_version":2}',pg_temp.bpterms()||'{"sender_verified":true}'] loop
  perform pg_temp.bpheaders(invalid); perform pg_temp.bpreject('direct','RESCHEDULE_POLICY_TERMS_INVALID');
 end loop;
end$$;
select extensions.pass('13. Expanded, mistyped, fractional, unsafe and missing fields roll back all creation projections');
select set_config('request.headers',jsonb_build_object('x-cita-reschedule-policy','{broken')::text,true);
select pg_temp.bpreject('direct','RESCHEDULE_POLICY_TERMS_INVALID');
select extensions.pass('14. Malformed JSON is a known validation failure with atomic rollback');
select set_config('request.headers',jsonb_build_object('x-cita-reschedule-policy',repeat('x',1025))::text,true);
select pg_temp.bpreject('direct','RESCHEDULE_POLICY_TERMS_INVALID');
select extensions.pass('15. Oversized header is rejected without persistence');

-- Late failure, after all core writes, must roll back that whole transaction.
create function pg_temp.reject_informed_audit() returns trigger language plpgsql as $$begin
 if new.action='appointment.reschedule_policy_informed' then raise exception 'SYNTHETIC_INFORMED_AUDIT_FAILURE'; end if; return new;
end$$;
create trigger synthetic_informed_audit_failure before insert on public.audit_logs for each row execute function pg_temp.reject_informed_audit();
select pg_temp.bpheaders(pg_temp.bpterms());
select pg_temp.bpreject('integrated','SYNTHETIC_INFORMED_AUDIT_FAILURE');
drop trigger synthetic_informed_audit_failure on public.audit_logs;
select extensions.pass('16. Failed final audit rolls back patient, appointment, financial history, contact, context, intake and events');

-- With no deposit, no penalty can be enrolled even with a posted summary.
update public.deposit_policies set enabled=false where business_id=pg_temp.bpid('business');
insert into booking_policy_fixture values('no-deposit',pg_temp.bpbook()::text);
select extensions.ok((select not terms_acknowledged and not require_deposit_on_reschedule and previous_deposit_disposition='credit'
 from public.appointment_management_states where appointment_id=(pg_temp.bpv('no-deposit')::jsonb->>'id')::uuid)
 and not exists(select 1 from public.audit_logs where entity_id=(pg_temp.bpv('no-deposit')::jsonb->>'id')::uuid and action='appointment.reschedule_policy_informed'),
 '17. A booking without a deposit is not enrolled in new financial penalties');
select pg_temp.bpheaders(null);
select extensions.ok(pg_temp.bpbook()->>'id' is not null,'18. An enabled route does not require irrelevant monetary disclosure for a booking without deposit');
select extensions.ok((select not terms_acknowledged and accepted_at is null from public.appointment_management_states
 where appointment_id=(pg_temp.bpv('replay')::jsonb->>'id')::uuid),
 '19. All preference edits and later informed bookings leave the original uninformed reservation untouched');
select extensions.ok(not has_function_privilege('anon','private.accept_booking_reschedule_policy(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','private.accept_booking_reschedule_policy(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('service_role','private.accept_booking_reschedule_policy(uuid,uuid,uuid)','EXECUTE'),
 '20. The enrollment helper is not an alternative API for enrolling another or existing appointment');
select * from extensions.finish();
rollback;

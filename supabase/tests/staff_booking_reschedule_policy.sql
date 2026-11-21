-- Staff may attest initial disclosure; a preference alone is not information.
begin;
select extensions.plan(10);
create temporary table staff_policy_fixture(label text primary key,value text not null);
create function pg_temp.spv(label text) returns text language sql as $$select value from staff_policy_fixture where staff_policy_fixture.label=$1$$;
create function pg_temp.spid(label text) returns uuid language sql as $$select pg_temp.spv($1)::uuid$$;
create function pg_temp.spterms() returns jsonb language sql as $$select jsonb_build_object('schema_version',1,'policy_revision',revision,
 'require_deposit_on_reschedule',require_deposit_on_reschedule,'previous_deposit_disposition',previous_deposit_disposition)
 from public.appointment_email_policies where business_id=pg_temp.spid('business')$$;
create function pg_temp.spheader(terms jsonb) returns void language plpgsql as $$begin
 perform set_config('request.headers',case when terms is null then '{}' else jsonb_build_object('x-cita-reschedule-policy',terms::text)::text end,true);
end$$;
create function pg_temp.spcounts() returns jsonb language sql as $$select jsonb_build_array(
 (select count(*) from public.patients where business_id=pg_temp.spid('business')),
 (select count(*) from public.appointments where business_id=pg_temp.spid('business')),
 (select count(*) from public.appointment_management_states where business_id=pg_temp.spid('business')),
 (select count(*) from public.appointment_deposits where business_id=pg_temp.spid('business')),
 (select count(*) from public.appointment_deposit_requirements where business_id=pg_temp.spid('business')),
 (select count(*) from public.appointment_deposit_events where business_id=pg_temp.spid('business')),
 (select count(*) from public.audit_logs where business_id=pg_temp.spid('business')),
 (select count(*) from private.appointment_email_events where business_id=pg_temp.spid('business')))$$;
do $$declare b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email) select id,'staff-policy-'||id||'@example.test' from unnest(array[u,r,viewer]) id;
 insert into public.businesses(id,name,slug,industry,timezone) values(b,'Synthetic staff disclosure',b::text,'other','UTC');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,u,'owner','active',now()),(b,r,'reception','active',now()),(b,viewer,'readonly','active',now());
 insert into public.services(id,business_id,name,duration_minutes) values(s,b,'Synthetic staff policy service',30);
 insert into public.professionals(id,business_id,name) values(p,b,'Synthetic staff policy professional');
 insert into public.professional_services(business_id,professional_id,service_id) values(b,p,s);
 insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes,is_active)
 select b,p,day,'08:00','18:00',30,0,true from generate_series(0,6) day;
 insert into staff_policy_fixture values('business',b::text),('owner',u::text),('reception',r::text),('readonly',viewer::text),('professional',p::text),('service',s::text),('key',gen_random_uuid()::text);
 update private.deposit_automation set enabled=true;
 update private.appointment_management_runtime set reschedule_enabled=true,email_producer_enabled=true;
 perform public.operator_set_business_email_sender(b,'staff-policy.cita-suite.com.ar','verified');
 insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,transfer_details,applies_to_manual)
 values(b,true,true,'fixed',40000,'Synthetic staff transfer',true);
end$$;
create function pg_temp.spbook(key text default gen_random_uuid()::text,actor uuid default null) returns jsonb language plpgsql as $$
declare result record; creator uuid:=coalesce(actor,pg_temp.spid('owner')); starts timestamptz; begin
 perform set_config('request.jwt.claim.sub',creator::text,true);
 select starts_at into starts from public.appointments where business_id=pg_temp.spid('business') and creation_request_key=key;
 if not found then starts:=date_trunc('day',now())+make_interval(days=>15+(select count(*)::integer from public.appointments where business_id=pg_temp.spid('business')),hours=>9); end if;
 select * into result from public.create_appointment_with_patient_identity(pg_temp.spid('business'),'new',null,'Synthetic Staff '||key,
 '+5493425000020','+5493425000020','staff-patient@example.test',false,pg_temp.spid('owner'),pg_temp.spid('service'),array[pg_temp.spid('professional')],starts,null,creator,false,'manual','valid',false,key);
 return to_jsonb(result);
end$$;
create function pg_temp.spreject(expected text,actor uuid default null) returns void language plpgsql as $$declare before jsonb:=pg_temp.spcounts(); begin
 begin perform pg_temp.spbook(gen_random_uuid()::text,actor); raise exception 'STAFF_POLICY_UNEXPECTED_SUCCESS';
 exception when others then if sqlerrm is distinct from expected then raise; end if; end;
 if pg_temp.spcounts() is distinct from before then raise exception 'STAFF_POLICY_PARTIAL_CREATION'; end if;
end$$;
select pg_temp.spheader(null);
insert into staff_policy_fixture values('uninformed',pg_temp.spbook()::text);
select extensions.ok((select not terms_acknowledged and not require_deposit_on_reschedule and previous_deposit_disposition='credit'
 from public.appointment_management_states where appointment_id=(pg_temp.spv('uninformed')::jsonb->>'id')::uuid),
 '1. Staff creation without an attestation keeps its deposit but adopts no new penalty');
do $$declare required boolean; disposition text; created jsonb; shown jsonb; begin
 foreach required in array array[true,false] loop foreach disposition in array array['forfeit','credit'] loop
  update public.appointment_email_policies set require_deposit_on_reschedule=required,previous_deposit_disposition=disposition,revision=revision+1 where business_id=pg_temp.spid('business');
  shown:=pg_temp.spterms(); perform pg_temp.spheader(shown); created:=pg_temp.spbook();
  if not exists(select 1 from public.appointment_management_states where appointment_id=(created->>'id')::uuid and terms_acknowledged
   and require_deposit_on_reschedule=required and previous_deposit_disposition=disposition
   and terms_snapshot->>'source'='staff_booking' and terms_snapshot->'disclosed'=shown and terms_snapshot->'effective'=shown) then raise exception 'STAFF_POLICY_SNAPSHOT_WRONG'; end if;
  if (select count(*) from public.audit_logs where entity_id=(created->>'id')::uuid and action='appointment.reschedule_policy_informed'
   and user_id=pg_temp.spid('owner') and metadata->>'source'='staff_booking')<>1 then raise exception 'STAFF_POLICY_AUDIT_ACTOR_WRONG'; end if;
  if (select count(*) from private.appointment_email_events where appointment_id=(created->>'id')::uuid and purpose='booking_receipt')<>1 then raise exception 'STAFF_BOOKING_EVENT_MISSING'; end if;
 end loop; end loop;
end$$;
select extensions.pass('2. Four informed staff combinations preserve exact terms, staff source and real creator in one transaction');
select pg_temp.spheader(pg_temp.spterms());
insert into staff_policy_fixture values('reception-result',pg_temp.spbook(gen_random_uuid()::text,pg_temp.spid('reception'))::text);
select extensions.ok(exists(select 1 from public.audit_logs where entity_id=(pg_temp.spv('reception-result')::jsonb->>'id')::uuid
 and action='appointment.reschedule_policy_informed' and user_id=pg_temp.spid('reception')),
 '3. Reception can attest disclosure without acquiring permission to configure the policy');
select pg_temp.spreject('APPOINTMENT_CREATOR_INVALID',pg_temp.spid('readonly'));
select extensions.pass('4. Read-only cannot enroll or create, even with a valid financial header');
select pg_temp.spheader(pg_temp.spterms());
update public.appointment_email_policies set require_deposit_on_reschedule=true,previous_deposit_disposition='forfeit',revision=revision+1 where business_id=pg_temp.spid('business');
select pg_temp.spreject('RESCHEDULE_POLICY_TERMS_CHANGED');
select extensions.pass('5. A stricter policy rejects the attested old summary with no partial patient, turn, obligation, money history or audit');
select pg_temp.spheader(pg_temp.spterms());
insert into staff_policy_fixture values('replay',pg_temp.spbook(pg_temp.spv('key'))::text);
select pg_temp.spheader(null);
do $$declare before jsonb:=pg_temp.spcounts(); again jsonb; begin
 again:=pg_temp.spbook(pg_temp.spv('key'));
 if again->>'id' is distinct from pg_temp.spv('replay')::jsonb->>'id' or again->>'idempotent_replay'<>'true' or before is distinct from pg_temp.spcounts() then raise exception 'STAFF_POLICY_REPLAY_CHANGED_TERMS'; end if;
end$$;
select extensions.pass('6. A completed staff creation is recovered without re-attesting or duplicating effects');
select pg_temp.spheader(pg_temp.spterms()||'{"actor_id":"forged"}');
select pg_temp.spreject('RESCHEDULE_POLICY_TERMS_INVALID');
select extensions.pass('7. Staff cannot smuggle actor or extra policy fields through the disclosure header');
create function pg_temp.reject_staff_policy_audit() returns trigger language plpgsql as $$begin
 if new.action='appointment.reschedule_policy_informed' then raise exception 'SYNTHETIC_STAFF_POLICY_AUDIT_FAILURE'; end if; return new;
end$$;
create trigger synthetic_staff_policy_audit_failure before insert on public.audit_logs for each row execute function pg_temp.reject_staff_policy_audit();
select pg_temp.spheader(pg_temp.spterms());
select pg_temp.spreject('SYNTHETIC_STAFF_POLICY_AUDIT_FAILURE');
drop trigger synthetic_staff_policy_audit_failure on public.audit_logs;
select extensions.pass('8. A failed final disclosure audit rolls back the whole staff creation');
update public.deposit_policies set applies_to_manual=false where business_id=pg_temp.spid('business');
insert into staff_policy_fixture values('no-deposit',pg_temp.spbook()::text);
select extensions.ok((select not terms_acknowledged from public.appointment_management_states where appointment_id=(pg_temp.spv('no-deposit')::jsonb->>'id')::uuid),
 '9. A staff turn without a deposit is not enrolled merely because a checkbox was attested');
select extensions.ok(not has_function_privilege('anon','private.accept_booking_reschedule_policy(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','private.accept_booking_reschedule_policy(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('service_role','private.accept_booking_reschedule_policy(uuid,uuid,uuid)','EXECUTE'),
 '10. Shared validation has no alternative API that can enroll another appointment or choose its actor');
select * from extensions.finish();
rollback;

#!/usr/bin/env bash
set -euo pipefail
# Observe real PostgreSQL waits; sleep is only a barrier polling interval.
database_url="${SUPABASE_TEST_DB_URL:-postgresql://postgres:postgres@127.0.0.1:55422/postgres}"
case "$database_url" in postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;; *) exit 2;; esac
scratch=$(mktemp -d)
first_pid=''; second_pid=''
query() { psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt "$@"; }
cleanup() {
 local cleanup_status=$?
 trap - EXIT
 for child in "$first_pid" "$second_pid"; do if [ -n "$child" ]; then kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi; done
 if ! query <<'SQL' >"$scratch/cleanup.log" 2>&1
begin;
do $$begin
 if to_regclass('booking_policy_race.original_runtime') is not null then
  update private.deposit_automation set enabled=(select deposit_enabled from booking_policy_race.original_runtime);
  update private.appointment_management_runtime set reschedule_enabled=(select reschedule_enabled from booking_policy_race.original_runtime),
   email_producer_enabled=(select email_producer_enabled from booking_policy_race.original_runtime);
 end if;
end$$;
drop schema if exists booking_policy_race cascade;
-- Financial history retains its patient FK. Remove the appointments first,
-- as the existing management/deposit harnesses do; no FK is disabled.
delete from public.appointments where business_id='b9300000-0000-4000-8000-000000000001';
delete from public.businesses where id='b9300000-0000-4000-8000-000000000001';
delete from auth.users where id='b9400000-0000-4000-8000-000000000001';
commit;
SQL
 then cat "$scratch/cleanup.log" >&2; cleanup_status=1; fi
 rm -r -- "$scratch"
 return "$cleanup_status"
}
trap cleanup EXIT
query <<'SQL'
create schema booking_policy_race;
create table booking_policy_race.original_runtime as select d.enabled as deposit_enabled,r.reschedule_enabled,r.email_producer_enabled
 from private.deposit_automation d cross join private.appointment_management_runtime r where d.singleton and r.singleton;
create table booking_policy_race.control(label text primary key,go boolean not null default false,shown jsonb);
insert into booking_policy_race.control(label) values('tighten'),('booking'),('relax'),('staff');
create table booking_policy_race.results(label text primary key,result jsonb);
create function booking_policy_race.wait_go(p_label text) returns void language plpgsql as $$begin
 for attempt in 1..1500 loop
  if (select go from booking_policy_race.control where label=p_label) then return; end if;
  perform pg_sleep(0.02);
 end loop; raise exception 'POLICY_RACE_BARRIER_TIMEOUT';
end$$;
insert into auth.users(id,email) values('b9400000-0000-4000-8000-000000000001','informed-policy-race@example.test');
insert into public.businesses(id,name,slug,industry,timezone,public_booking_enabled,max_booking_days_ahead)
 values('b9300000-0000-4000-8000-000000000001','Synthetic informed policy race','synthetic-informed-policy-race','other','UTC',true,90);
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null
 where business_id='b9300000-0000-4000-8000-000000000001';
insert into public.business_users(business_id,user_id,role,status,accepted_at)
 values('b9300000-0000-4000-8000-000000000001','b9400000-0000-4000-8000-000000000001','owner','active',now());
insert into public.services(id,business_id,name,duration_minutes,is_public)
 values('b9600000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001','Synthetic policy service',30,true);
insert into public.professionals(id,business_id,name,is_public)
 values('b9700000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001','Synthetic policy professional',true);
insert into public.professional_services(business_id,professional_id,service_id)
 values('b9300000-0000-4000-8000-000000000001','b9700000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001');
insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes,is_active)
 select 'b9300000-0000-4000-8000-000000000001','b9700000-0000-4000-8000-000000000001',day,'08:00','18:00',30,0,true from generate_series(0,6) day;
update private.deposit_automation set enabled=true;
update private.appointment_management_runtime set reschedule_enabled=true;
insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,transfer_details,applies_to_manual)
 values('b9300000-0000-4000-8000-000000000001',true,true,'fixed',40000,'Synthetic policy race transfer',true);
create function booking_policy_race.save(p_required boolean,p_disposition text) returns void language plpgsql as $$begin
 perform public.save_appointment_email_policy('b9300000-0000-4000-8000-000000000001',jsonb_build_object(
  'email_enabled',true,'require_email',true,'show_cancel',true,'show_reschedule',true,
  'require_deposit_on_reschedule',p_required,'previous_deposit_disposition',p_disposition),
  (select revision from public.appointment_email_policies where business_id='b9300000-0000-4000-8000-000000000001'));
end$$;
create function booking_policy_race.remember(p_label text) returns void language sql as $$
 update booking_policy_race.control set shown=(select jsonb_build_object('schema_version',1,'policy_revision',revision,
 'require_deposit_on_reschedule',require_deposit_on_reschedule,'previous_deposit_disposition',previous_deposit_disposition)
 from public.appointment_email_policies where business_id='b9300000-0000-4000-8000-000000000001') where label=p_label
$$;
create function booking_policy_race.book(p_label text,p_key text,p_hour integer) returns jsonb language plpgsql as $$declare result record; begin
 perform set_config('request.headers',jsonb_build_object('x-cita-reschedule-policy',(select shown from booking_policy_race.control where label=p_label)::text)::text,true);
 select * into result from public.create_appointment_with_patient_identity('b9300000-0000-4000-8000-000000000001','public',null,'Synthetic Informed '||p_key,
 '+5493425000010','+5493425000010','Informed+Race@Example.test',false,null,
 'b9600000-0000-4000-8000-000000000001',array['b9700000-0000-4000-8000-000000000001'::uuid],
 date_trunc('day',now())+interval '25 days'+make_interval(hours=>p_hour),null,null,false,'public_booking','valid',false,p_key);
 return to_jsonb(result);
end$$;
create function booking_policy_race.counts() returns jsonb language sql as $$select jsonb_build_array(
 (select count(*) from public.appointments where business_id='b9300000-0000-4000-8000-000000000001'),
 (select count(*) from public.patients where business_id='b9300000-0000-4000-8000-000000000001'),
 (select count(*) from public.appointment_management_states where business_id='b9300000-0000-4000-8000-000000000001'),
 (select count(*) from public.appointment_deposit_requirements where business_id='b9300000-0000-4000-8000-000000000001'),
 (select count(*) from public.appointment_deposit_events where business_id='b9300000-0000-4000-8000-000000000001'),
 (select count(*) from private.appointment_email_events where business_id='b9300000-0000-4000-8000-000000000001'),
 (select count(*) from public.audit_logs where business_id='b9300000-0000-4000-8000-000000000001'))$$;
grant usage on schema booking_policy_race to authenticated;
grant select on booking_policy_race.control to authenticated;
grant execute on function booking_policy_race.save(boolean,text),booking_policy_race.wait_go(text) to authenticated;
SQL
owner_claim="select set_config('request.jwt.claims','{\"role\":\"authenticated\",\"sub\":\"b9400000-0000-4000-8000-000000000001\"}',true); set local role authenticated;"
for scenario in tighten booking relax; do
 if [ "$scenario" = relax ]; then initial_required=true; initial_disposition=forfeit; else initial_required=false; initial_disposition=credit; fi
 query -c "begin; $owner_claim select booking_policy_race.save($initial_required,'$initial_disposition'); commit; select booking_policy_race.remember('$scenario');" >/dev/null
 case "$scenario" in
  tighten) first_operation="$owner_claim select booking_policy_race.save(true,'forfeit');"; second_operation="select booking_policy_race.book('tighten','b9800000-0000-4000-8000-000000000001',9);";;
  booking) first_operation="insert into booking_policy_race.results values('booking',booking_policy_race.book('booking','b9800000-0000-4000-8000-000000000002',11));"; second_operation="$owner_claim select booking_policy_race.save(true,'forfeit');";;
  relax) first_operation="$owner_claim select booking_policy_race.save(false,'credit');"; second_operation="insert into booking_policy_race.results values('relax',booking_policy_race.book('relax','b9800000-0000-4000-8000-000000000003',13));";;
 esac
 PGAPPNAME=booking-policy-first query -c "begin; $first_operation select pg_advisory_xact_lock(943173); select booking_policy_race.wait_go('$scenario'); commit;" >"$scratch/$scenario-first.log" 2>&1 &
 first_pid=$!
 ready=false
 for attempt in $(seq 1 300); do
  if [ "$(query -c "select exists(select 1 from pg_locks where locktype='advisory' and classid=0 and objid=943173 and granted);" 2>/dev/null || true)" = t ]; then ready=true; break; fi
  sleep 0.02
 done
 if [ "$ready" != true ]; then cat "$scratch/$scenario-first.log"; echo 'Policy first operation did not reach its barrier' >&2; exit 1; fi
 PGAPPNAME=booking-policy-second query -c "begin; $second_operation commit;" >"$scratch/$scenario-second.log" 2>&1 &
 second_pid=$!
 observed=false
 for attempt in $(seq 1 300); do
  if [ "$(query -c "select exists(select 1 from pg_stat_activity s join pg_stat_activity f on f.application_name='booking-policy-first' where s.application_name='booking-policy-second' and f.pid=any(pg_blocking_pids(s.pid)));" 2>/dev/null || true)" = t ]; then observed=true; break; fi
  sleep 0.02
 done
 query -c "update booking_policy_race.control set go=true where label='$scenario';" >/dev/null
 set +e
 wait "$first_pid"; first_result=$?; first_pid=''
 wait "$second_pid"; second_result=$?; second_pid=''
 set -e
 if [ "$observed" != true ] || [ "$first_result" -ne 0 ]; then
  cat "$scratch/$scenario-first.log" "$scratch/$scenario-second.log"; echo 'Policy contention was not exercised' >&2; exit 1
 fi
 if [ "$scenario" = tighten ]; then
  if [ "$second_result" -eq 0 ] || ! grep -q 'RESCHEDULE_POLICY_TERMS_CHANGED' "$scratch/$scenario-second.log"; then cat "$scratch/$scenario-second.log"; exit 1; fi
  query <<'SQL'
do $$begin
 if exists(select 1 from public.appointments where business_id='b9300000-0000-4000-8000-000000000001')
  or exists(select 1 from public.patients where business_id='b9300000-0000-4000-8000-000000000001')
  or exists(select 1 from private.public_booking_email_contacts where business_id='b9300000-0000-4000-8000-000000000001')
  or exists(select 1 from private.appointment_email_events where business_id='b9300000-0000-4000-8000-000000000001')
  or exists(select 1 from public.audit_logs where business_id='b9300000-0000-4000-8000-000000000001' and entity_type='appointment') then raise exception 'TIGHTENING_LEFT_PARTIAL_BOOKING'; end if;
end$$;
SQL
 elif [ "$second_result" -ne 0 ]; then cat "$scratch/$scenario-second.log"; exit 1; fi
done
query <<'SQL'
do $$declare result jsonb; again jsonb; counts jsonb; begin
 if (select count(*) from public.appointments where business_id='b9300000-0000-4000-8000-000000000001')<>2 then raise exception 'CONTENDED_INFORMED_BOOKING_COUNT'; end if;
 if exists(select 1 from public.appointment_management_states where business_id='b9300000-0000-4000-8000-000000000001'
  and (not terms_acknowledged or require_deposit_on_reschedule or previous_deposit_disposition<>'credit')) then raise exception 'CONTENDED_POLICY_WORSENED'; end if;
 select r.result into result from booking_policy_race.results r where label='relax';
 if not exists(select 1 from public.appointment_management_states where appointment_id=(result->>'id')::uuid
  and terms_snapshot->'disclosed'->>'previous_deposit_disposition'='forfeit' and terms_snapshot->'effective'->>'previous_deposit_disposition'='credit') then raise exception 'RELAXATION_DISCLOSURE_LOST'; end if;
 select r.result into result from booking_policy_race.results r where label='booking';
 select jsonb_build_array((select count(*) from public.audit_logs),(select count(*) from public.appointment_deposit_events)) into counts;
 again:=booking_policy_race.book('booking','b9800000-0000-4000-8000-000000000002',11);
 if again->>'id' is distinct from result->>'id' or again->>'idempotent_replay'<>'true' then raise exception 'CONTENDED_RESPONSE_RECOVERY_FAILED'; end if;
 if counts is distinct from jsonb_build_array((select count(*) from public.audit_logs),(select count(*) from public.appointment_deposit_events)) then raise exception 'CONTENDED_REPLAY_DUPLICATED_EFFECTS'; end if;
 if (select count(*) from public.audit_logs where business_id='b9300000-0000-4000-8000-000000000001' and action='appointment.reschedule_policy_informed')<>2 then raise exception 'CONTENDED_INFORMED_AUDIT'; end if;
end$$;
SQL
# An actor can be valid at the first check and expire at the newly added final
# policy wait. The producer is on so rollback must cover an actual queue write.
query <<'SQL'
update private.appointment_management_runtime set email_producer_enabled=true;
select public.operator_set_business_email_sender('b9300000-0000-4000-8000-000000000001','booking-policy-race.cita-suite.com.ar','verified');
select booking_policy_race.remember('staff');
insert into booking_policy_race.results values('staff-before',booking_policy_race.counts());
update public.business_subscriptions set is_permanent=false,paid_until=clock_timestamp()+interval '3 seconds',grace_until=null
 where business_id='b9300000-0000-4000-8000-000000000001';
SQL
PGAPPNAME=booking-policy-first query -c "begin; $owner_claim select booking_policy_race.save(false,'credit'); select pg_advisory_xact_lock(943173); select booking_policy_race.wait_go('staff'); commit;" >"$scratch/staff-first.log" 2>&1 &
first_pid=$!
ready=false
for attempt in $(seq 1 300); do
 if [ "$(query -c "select exists(select 1 from pg_locks where locktype='advisory' and classid=0 and objid=943173 and granted);" 2>/dev/null || true)" = t ]; then ready=true; break; fi
 sleep 0.02
done
if [ "$ready" != true ]; then cat "$scratch/staff-first.log"; echo 'Staff policy barrier not reached' >&2; exit 1; fi
PGAPPNAME=booking-policy-second query <<'SQL' >"$scratch/staff-second.log" 2>&1 &
begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.headers',jsonb_build_object('x-cita-reschedule-policy',(select shown from booking_policy_race.control where label='staff')::text)::text,true);
select public.create_appointment_with_patient_identity('b9300000-0000-4000-8000-000000000001','new',null,'Synthetic Staff Expiry',
 '+5493425000020','+5493425000020','Staff+Expiry@Example.test',false,'b9400000-0000-4000-8000-000000000001',
 'b9600000-0000-4000-8000-000000000001',array['b9700000-0000-4000-8000-000000000001'::uuid],date_trunc('day',now())+interval '26 days 9 hours',
 null,'b9400000-0000-4000-8000-000000000001',false,'manual','valid',false,'b9800000-0000-4000-8000-000000000004');
commit;
SQL
second_pid=$!
observed=false
for attempt in $(seq 1 300); do
 if [ "$(query -c "select exists(select 1 from pg_stat_activity s join pg_stat_activity f on f.application_name='booking-policy-first' where s.application_name='booking-policy-second' and f.pid=any(pg_blocking_pids(s.pid)));" 2>/dev/null || true)" = t ]; then observed=true; break; fi
 sleep 0.02
done
query -c "select pg_sleep(greatest(extract(epoch from (paid_until-clock_timestamp())),0)+0.025) from public.business_subscriptions where business_id='b9300000-0000-4000-8000-000000000001'; update booking_policy_race.control set go=true where label='staff';" >/dev/null
set +e
wait "$first_pid"; first_result=$?; first_pid=''
wait "$second_pid"; second_result=$?; second_pid=''
set -e
if [ "$observed" != true ] || [ "$first_result" -ne 0 ] || [ "$second_result" -eq 0 ] || ! grep -q 'APPOINTMENT_CREATOR_INVALID' "$scratch/staff-second.log"; then
 cat "$scratch/staff-first.log" "$scratch/staff-second.log"; echo 'Staff expiry must reject after its observed policy wait' >&2; exit 1
fi
query <<'SQL'
do $$begin
 if booking_policy_race.counts() is distinct from (select result from booking_policy_race.results where label='staff-before') then raise exception 'EXPIRED_STAFF_PARTIAL_CREATION'; end if;
end$$;
SQL
cleanup
trap - EXIT
query <<'SQL'
do $$begin
 if to_regnamespace('booking_policy_race') is not null or exists(select 1 from public.businesses where id='b9300000-0000-4000-8000-000000000001')
 or exists(select 1 from auth.users where id='b9400000-0000-4000-8000-000000000001') then raise exception 'POLICY_RACE_CLEANUP_FAILED'; end if;
end$$;
SQL
echo 'Informed booking: three public policy orders, staff expiry at final policy wait, response recovery and cleanup verified with observed PostgreSQL waits.'
